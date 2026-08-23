/**
 * P0-1: the transaction routes had no atomicity.
 *
 * BEGIN, the writes, and COMMIT were each issued through `pool.query()`, which
 * checks out an arbitrary idle connection per call — so under any concurrency
 * the BEGIN and the COMMIT could land on different sessions, and a failed
 * account UPDATE left the transaction row behind. `withTransaction` pins all
 * of it to one client.
 *
 * The failure is forced with a CHECK constraint that rejects the new balance:
 * the only way to make the second write fail after the first has already
 * succeeded inside the same transaction.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { DELETE, PATCH, POST } from "@/app/api/transactions/route"
import { accountById, countTransactions, createAccount } from "./support/fixtures"
import { truncateAll } from "./support/database"

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

function del(id: string) {
  return DELETE(
    new NextRequest(`http://localhost/api/transactions?id=${id}`, { method: "DELETE" })
  )
}

const DROP_FLOOR = `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS test_balance_floor`

beforeEach(async () => {
  await pool.query(DROP_FLOOR)
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.query(DROP_FLOOR)
  await pool.end()
})

describe("POST /api/transactions", () => {
  it("writes both the transaction and the balance", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })

    const res = await post({
      date: "2026-08-22",
      amount: 250,
      category: "grocery",
      account_id: account.id,
      description: "Weekly shop",
    })

    expect(res.status).toBe(201)
    expect(await countTransactions(pool)).toBe(1)
    expect((await accountById(pool, account.id)).balance).toBe(750)
  })

  it("writes NOTHING when the account UPDATE fails (P0-1)", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })

    // Scoped to this account so no other row is affected. Any expense takes
    // the balance below 900, so the UPDATE inside the transaction fails after
    // the INSERT has already succeeded.
    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT test_balance_floor
         CHECK (name <> 'Checking' OR balance >= 900)`
    )

    const res = await post({
      date: "2026-08-22",
      amount: 250,
      category: "grocery",
      account_id: account.id,
      description: "Weekly shop",
    })

    expect(res.status).toBe(500)

    // The whole point: the INSERT must have been rolled back with the UPDATE.
    expect(await countTransactions(pool)).toBe(0)
    expect((await accountById(pool, account.id)).balance).toBe(1000)
  })

  it("does not leak the driver's error message to the client (P0-16)", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT test_balance_floor
         CHECK (name <> 'Checking' OR balance >= 900)`
    )

    const res = await post({
      date: "2026-08-22",
      amount: 250,
      category: "grocery",
      account_id: account.id,
    })
    const body = await res.json()

    expect(JSON.stringify(body)).not.toMatch(/constraint|relation|column|violates/i)
  })

  it("accepts a POST with no description, which used to be a guaranteed 500", async () => {
    // transactions.description is NOT NULL and the route inserted
    // `description ?? null`, so every description-less POST failed.
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })

    const res = await post({
      date: "2026-08-22",
      amount: 40,
      category: "grocery",
      account_id: account.id,
    })

    expect(res.status).toBe(201)
    const { rows } = await pool.query(`SELECT description FROM transactions`)
    expect(rows[0].description).toBe("grocery")
  })

  it("credits max, not balance, for income to a bank account", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
      max: 0,
    })

    const res = await post({
      date: "2026-08-22",
      amount: 500,
      category: "income",
      account_id: account.id,
    })

    expect(res.status).toBe(201)
    const after = await accountById(pool, account.id)
    expect(after.balance).toBe(1000)
    expect(after.max).toBe(500)
  })

  it("rejects income to a credit account", async () => {
    const account = await createAccount(pool, {
      name: "Amex",
      type: "Credit Card",
      balance: -100,
      max: 5000,
    })

    const res = await post({
      date: "2026-08-22",
      amount: 500,
      category: "income",
      account_id: account.id,
    })

    expect(res.status).toBe(400)
    expect(await countTransactions(pool)).toBe(0)
    expect((await accountById(pool, account.id)).max).toBe(5000)
  })

  it("404s for an account that does not exist, writing nothing", async () => {
    const res = await post({
      date: "2026-08-22",
      amount: 40,
      category: "grocery",
      account_id: "00000000-0000-0000-0000-000000000000",
    })

    expect(res.status).toBe(404)
    expect(await countTransactions(pool)).toBe(0)
  })
})

describe("PATCH /api/transactions", () => {
  it("moves the balance by the delta only", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    const created = await (
      await post({
        date: "2026-08-22",
        amount: 250,
        category: "grocery",
        account_id: account.id,
      })
    ).json()

    const res = await patch({ id: created.id, amount: 300 })
    expect(res.status).toBe(200)

    // 1000 - 250 = 750, then a further 50 for the increase.
    expect((await accountById(pool, account.id)).balance).toBe(700)
  })

  it("corrects both accounts when a transaction moves between them", async () => {
    const from = await createAccount(pool, { name: "From", type: "Checking", balance: 1000 })
    const to = await createAccount(pool, { name: "To", type: "Checking", balance: 1000 })

    const created = await (
      await post({
        date: "2026-08-22",
        amount: 250,
        category: "grocery",
        account_id: from.id,
      })
    ).json()

    await patch({ id: created.id, account_id: to.id })

    expect((await accountById(pool, from.id)).balance).toBe(1000)
    expect((await accountById(pool, to.id)).balance).toBe(750)
  })

  it("rolls back the transaction row when the balance update fails", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    const created = await (
      await post({
        date: "2026-08-22",
        amount: 100,
        category: "grocery",
        account_id: account.id,
      })
    ).json()

    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT test_balance_floor
         CHECK (name <> 'Checking' OR balance >= 800)`
    )

    const res = await patch({ id: created.id, amount: 500 })
    expect(res.status).toBe(500)

    const { rows } = await pool.query(
      `SELECT amount::float8 AS amount FROM transactions WHERE id = $1`,
      [created.id]
    )
    expect(rows[0].amount).toBe(100)
    expect((await accountById(pool, account.id)).balance).toBe(900)
  })
})

describe("DELETE /api/transactions", () => {
  it("restores the balance exactly", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    const created = await (
      await post({
        date: "2026-08-22",
        amount: 250,
        category: "grocery",
        account_id: account.id,
      })
    ).json()

    const res = await del(created.id)
    expect(res.status).toBe(200)
    expect(await countTransactions(pool)).toBe(0)
    expect((await accountById(pool, account.id)).balance).toBe(1000)
  })

  it("keeps the row when the balance restore fails", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    const created = await (
      await post({
        date: "2026-08-22",
        amount: 250,
        category: "income",
        account_id: account.id,
      })
    ).json()

    // Income raised max to 250; deleting must lower it again, which this
    // constraint forbids.
    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT test_balance_floor
         CHECK (name <> 'Checking' OR max >= 250)`
    )

    const res = await del(created.id)
    expect(res.status).toBe(500)
    expect(await countTransactions(pool)).toBe(1)
    expect((await accountById(pool, account.id)).max).toBe(250)
  })
})
