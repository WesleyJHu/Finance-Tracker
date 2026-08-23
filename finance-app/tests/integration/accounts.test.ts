/**
 * P0-9: deleting an account was entirely broken.
 *
 * `transactions.account_id` was NOT NULL with an `ON DELETE SET NULL` foreign
 * key — a combination that can never succeed — so deleting an account with any
 * transaction failed outright, and the UI offered the button anyway with no
 * confirmation. Delete is now an archive: the row stays, its history stays,
 * and it disappears from every picker.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { DELETE, GET } from "@/app/api/accounts/route"
import { accountById, createAccount } from "./support/fixtures"
import { truncateAll } from "./support/database"
import type { Account } from "@/types/api"

function list(query = ""): Promise<Account[]> {
  return GET(new NextRequest(`http://localhost/api/accounts${query}`)).then((r) => r.json())
}

function archive(id: string) {
  return DELETE(
    new NextRequest("http://localhost/api/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  )
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("DELETE /api/accounts", () => {
  it("archives rather than deletes, keeping the transactions", async () => {
    const account = await createAccount(pool, {
      name: "Old Card",
      type: "Credit Card",
      balance: -100,
    })
    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ('2026-08-01', 100, 'coffee', 'food', $1)`,
      [account.id]
    )

    const res = await archive(account.id)
    expect(res.status).toBe(200)

    // The row survives, flagged.
    expect((await accountById(pool, account.id)).archived).toBe(true)

    // And so does its history, which still counts toward monthly totals.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM transactions`)
    expect(rows[0].n).toBe(1)
  })

  it("hides the archived account from the endpoint every picker reads", async () => {
    const kept = await createAccount(pool, { name: "Checking", type: "Checking" })
    const gone = await createAccount(pool, { name: "Old Card", type: "Credit Card" })

    await archive(gone.id)

    const visible = await list()
    expect(visible.map((a) => a.id)).toEqual([kept.id])

    // Still reachable for anything that needs the full set.
    const all = await list("?includeArchived=true")
    expect(all.map((a) => a.id).sort()).toEqual([kept.id, gone.id].sort())
  })

  it("is idempotent", async () => {
    const account = await createAccount(pool, { name: "Old Card", type: "Credit Card" })

    expect((await archive(account.id)).status).toBe(200)
    expect((await archive(account.id)).status).toBe(200)
    expect((await accountById(pool, account.id)).archived).toBe(true)
  })

  it("404s for an account that does not exist", async () => {
    const res = await archive("00000000-0000-0000-0000-000000000000")
    expect(res.status).toBe(404)
  })

  it("still refuses a hard delete that would orphan history", async () => {
    // ON DELETE RESTRICT is the backstop behind the archive behaviour: even a
    // direct SQL delete cannot orphan a transaction. The old FK was
    // ON DELETE SET NULL against a NOT NULL column, which could never fire.
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ('2026-08-01', 100, 'coffee', 'food', $1)`,
      [account.id]
    )

    const error = await pool
      .query(`DELETE FROM accounts WHERE id = $1`, [account.id])
      .then(() => null)
      .catch((e) => e as { code?: string })

    // ON DELETE RESTRICT raises restrict_violation (23001); a plain NO ACTION
    // foreign key would raise foreign_key_violation (23503). Either means the
    // delete was refused, which is the guarantee under test.
    expect(["23001", "23503"]).toContain(error?.code)
  })
})

describe("accounts.max", () => {
  it("cannot be null, so income can never destroy the column", async () => {
    // `max = max + $2` evaluates to NULL for a null max, silently wiping the
    // credit limit. The column is NOT NULL DEFAULT 0 now.
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })

    const error = await pool
      .query(`UPDATE accounts SET max = NULL WHERE id = $1`, [account.id])
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23502")
  })

  it("defaults to 0 rather than null for a new account", async () => {
    const { rows } = await pool.query(
      `INSERT INTO accounts (name, type) VALUES ('Bare', 'Checking') RETURNING max::float8 AS max`
    )
    expect(rows[0].max).toBe(0)
  })
})
