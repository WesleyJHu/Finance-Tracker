/**
 * P0-1 again, this time under real concurrency — the version of the test that
 * actually discriminates.
 *
 * The rollback test in transactions-atomicity.test.ts passes against the OLD
 * code too, because with an idle pool `pool.query()` happens to hand back the
 * same connection every time, so the BEGIN and the COMMIT accidentally line
 * up. The bug only shows when other requests are interleaved and the pool
 * hands out a different connection mid-transaction.
 *
 * So: fire a batch of failing writes at the same time as a batch of succeeding
 * ones, and count the transaction rows that survived a rolled-back request.
 * Against the pre-fix code this test found nine orphaned rows; it must find
 * zero.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { POST } from "@/app/api/transactions/route"
import { accountById, createAccount } from "./support/fixtures"
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

const DROP_FLOOR = `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS test_balance_floor`

beforeEach(async () => {
  await pool.query(DROP_FLOOR)
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.query(DROP_FLOOR)
  await pool.end()
})

describe("concurrent writes", () => {
  it("leaves no orphaned transaction rows when requests interleave (P0-1)", async () => {
    const guarded = await createAccount(pool, {
      name: "Guarded",
      type: "Checking",
      balance: 1000,
    })
    const churn = await createAccount(pool, {
      name: "Churn",
      type: "Checking",
      balance: 1_000_000,
    })

    // Every write against "Guarded" must fail; every write against "Churn"
    // must succeed. Running them together is what forces the pool to hand a
    // different connection to the middle of a transaction.
    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT test_balance_floor
         CHECK (name <> 'Guarded' OR balance >= 1000)`
    )

    const ROUNDS = 6
    const FAILING = 6
    const SUCCEEDING = 24

    for (let round = 0; round < ROUNDS; round++) {
      const requests: Promise<Response>[] = []
      for (let i = 0; i < FAILING; i++) {
        requests.push(
          post({
            date: "2026-08-22",
            amount: 10,
            category: "grocery",
            account_id: guarded.id,
            description: `fail-${round}-${i}`,
          })
        )
      }
      for (let i = 0; i < SUCCEEDING; i++) {
        requests.push(
          post({
            date: "2026-08-22",
            amount: 1,
            category: "grocery",
            account_id: churn.id,
            description: `ok-${round}-${i}`,
          })
        )
      }
      await Promise.all(requests)
    }

    // Not one row from a rolled-back request may survive.
    const orphans = await pool.query(
      `SELECT count(*)::int AS n FROM transactions WHERE account_id = $1`,
      [guarded.id]
    )
    expect(orphans.rows[0].n).toBe(0)
    expect((await accountById(pool, guarded.id)).balance).toBe(1000)

    // And the succeeding writes all landed, each exactly once.
    const applied = await pool.query(
      `SELECT count(*)::int AS n FROM transactions WHERE account_id = $1`,
      [churn.id]
    )
    expect(applied.rows[0].n).toBe(ROUNDS * SUCCEEDING)
    expect((await accountById(pool, churn.id)).balance).toBe(1_000_000 - ROUNDS * SUCCEEDING)
  })

  it("keeps a balance exact under concurrent writes to one account", async () => {
    // Read-modify-write would lose updates here. The routes do a relative
    // `balance = balance + $1` under FOR UPDATE, so the arithmetic is exact.
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })

    const WRITES = 40
    await Promise.all(
      Array.from({ length: WRITES }, (_, i) =>
        post({
          date: "2026-08-22",
          amount: 1,
          category: "grocery",
          account_id: account.id,
          description: `w-${i}`,
        })
      )
    )

    expect((await accountById(pool, account.id)).balance).toBe(1000 - WRITES)
  })
})
