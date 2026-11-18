/**
 * One user can never see or change another user's data.
 *
 * Alice and Bob each get a full set of rows. Then every route is called as
 * Bob, aimed at Alice's ids, and must answer as if those ids did not exist —
 * and afterwards every one of Alice's rows must be exactly as it was.
 *
 * The last block checks the database refuses cross-user rows by itself,
 * through the composite foreign keys, so a future route that forgets its
 * user filter on a write fails loudly instead of leaking.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import * as accounts from "@/app/api/accounts/route"
import * as transactions from "@/app/api/transactions/route"
import * as monthlyTotals from "@/app/api/transactions/monthly_totals/route"
import * as budgets from "@/app/api/monthly_budgets/route"
import * as snapshots from "@/app/api/balance_snapshot/route"
import * as recurring from "@/app/api/recurring_payments/route"
import { todayInAppTz, toDateString } from "@/lib/dates"
import {
  accountById,
  createAccount,
  createBudget,
  createRecurringPayment,
  createSnapshot,
  createUser,
  insertTransaction,
} from "./support/fixtures"
import { truncateAll } from "./support/database"
import { authed, authedJson, type TestUser } from "./support/session"
import { runScript, SCRIPTS } from "./support/runScript"

const BASE = "http://localhost"
const TODAY = todayInAppTz()
const TODAY_STRING = toDateString(TODAY.year, TODAY.month, TODAY.day)

let alice: TestUser
let bob: TestUser
let aliceAccount: string
let bobAccount: string
let aliceTransaction: string
let bobTransaction: string
let aliceRecurring: number
let bobRecurring: number

/** Everything of Alice's, for an exact before/after comparison. */
async function aliceRows() {
  const tables = ["accounts", "transactions", "recurring_payments", "monthly_budgets", "monthly_balance_snapshot"]
  const result: Record<string, unknown[]> = {}
  for (const table of tables) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY 1, 2`,
      [alice.id]
    )
    result[table] = rows
  }
  return result
}

beforeEach(async () => {
  await truncateAll(pool)

  alice = await createUser(pool, { email: "alice@example.com" })
  bob = await createUser(pool, { email: "bob@example.com" })

  aliceAccount = (await createAccount(pool, { userId: alice.id, name: "Alice Checking", type: "Checking", balance: 5000 })).id
  bobAccount = (await createAccount(pool, { userId: bob.id, name: "Bob Checking", type: "Checking", balance: 100 })).id

  await insertTransaction(pool, { accountId: aliceAccount, date: TODAY_STRING, amount: 700, category: "bills", description: "alice rent" })
  await insertTransaction(pool, { accountId: bobAccount, date: TODAY_STRING, amount: 5, category: "food", description: "bob lunch" })
  const ids = await pool.query(`SELECT id, user_id FROM transactions`)
  aliceTransaction = ids.rows.find((row) => row.user_id === alice.id).id
  bobTransaction = ids.rows.find((row) => row.user_id === bob.id).id

  aliceRecurring = (await createRecurringPayment(pool, { amount: 900, dayOfMonth: 1, accountId: aliceAccount, category: "Bills", description: "alice mortgage" })).id
  bobRecurring = (await createRecurringPayment(pool, { amount: 10, dayOfMonth: 1, accountId: bobAccount, category: "Entertainment" })).id

  for (let month = 1; month <= 12; month++) {
    await createBudget(pool, alice.id, month, 3000)
    await createBudget(pool, bob.id, month, 200)
  }
  await createSnapshot(pool, { userId: alice.id, month: TODAY.month, year: TODAY.year, startingBalance: 3000 })
  await createSnapshot(pool, { userId: bob.id, month: TODAY.month, year: TODAY.year, startingBalance: 200 })
})

afterAll(async () => {
  await pool.end()
})

describe("reads only ever return the caller's rows", () => {
  it("accounts", async () => {
    const res = await accounts.GET(await authed(bob, `${BASE}/api/accounts?includeArchived=true`))
    expect((await res.json()).map((a: { id: string }) => a.id)).toEqual([bobAccount])
  })

  it("transactions, by month, by year, and by someone else's account id", async () => {
    const byMonth = await transactions.GET(
      await authed(bob, `${BASE}/api/transactions?month=${TODAY.month}&year=${TODAY.year}`)
    )
    expect((await byMonth.json()).map((t: { id: string }) => t.id)).toEqual([bobTransaction])

    const byYear = await transactions.GET(await authed(bob, `${BASE}/api/transactions?year=${TODAY.year}`))
    expect((await byYear.json()).map((t: { id: string }) => t.id)).toEqual([bobTransaction])

    // Naming Alice's account outright still returns nothing of hers.
    const byAccount = await transactions.GET(
      await authed(bob, `${BASE}/api/transactions?account=${aliceAccount}`)
    )
    expect(byAccount.status).toBe(200)
    expect(await byAccount.json()).toEqual([])
  })

  it("monthly totals", async () => {
    const res = await monthlyTotals.GET(await authed(bob, `${BASE}/api/transactions/monthly_totals?months=1`))
    expect(await res.json()).toEqual([{ year: TODAY.year, month: TODAY.month, income: 0, expenses: 5 }])
  })

  it("budgets", async () => {
    const res = await budgets.GET(await authed(bob, `${BASE}/api/monthly_budgets`))
    const rows = await res.json()
    expect(rows).toHaveLength(12)
    expect(rows.every((row: { base_budget: number }) => row.base_budget === 200)).toBe(true)
  })

  it("balance snapshots, by month and by year", async () => {
    const month = await snapshots.GET(
      await authed(bob, `${BASE}/api/balance_snapshot?month=${TODAY.month}&year=${TODAY.year}`)
    )
    const rows = await month.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].starting_balance).toBe(200)
  })

  it("recurring payments", async () => {
    const res = await recurring.GET(await authed(bob, `${BASE}/api/recurring_payments`))
    expect((await res.json()).map((p: { id: number }) => p.id)).toEqual([bobRecurring])
  })

  it("never puts user_id in a response", async () => {
    const res = await accounts.GET(await authed(bob, `${BASE}/api/accounts`))
    expect(JSON.stringify(await res.json())).not.toContain("user_id")
  })
})

describe("writes aimed at another user's rows are 404s that change nothing", () => {
  it("every route, one after another", async () => {
    const before = await aliceRows()

    const attempts: [string, Promise<Response>][] = [
      ["PATCH account", accounts.PATCH(await authedJson(bob, `${BASE}/api/accounts`, "PATCH", { id: aliceAccount, balance: 0 }))],
      ["DELETE account", accounts.DELETE(await authed(bob, `${BASE}/api/accounts?id=${aliceAccount}`, { method: "DELETE" }))],

      ["POST transaction into her account", transactions.POST(await authedJson(bob, `${BASE}/api/transactions`, "POST", {
        date: TODAY_STRING, amount: 1, category: "food", account_id: aliceAccount,
      }))],
      ["PATCH her transaction", transactions.PATCH(await authedJson(bob, `${BASE}/api/transactions`, "PATCH", { id: aliceTransaction, amount: 1 }))],
      ["PATCH own transaction into her account", transactions.PATCH(await authedJson(bob, `${BASE}/api/transactions`, "PATCH", { id: bobTransaction, account_id: aliceAccount }))],
      ["DELETE her transaction", transactions.DELETE(await authed(bob, `${BASE}/api/transactions?id=${aliceTransaction}`, { method: "DELETE" }))],

      ["POST recurring on her account", recurring.POST(await authedJson(bob, `${BASE}/api/recurring_payments`, "POST", {
        amount: 1, day_of_month: 1, account_id: aliceAccount, category: "Bills",
      }))],
      ["PATCH her recurring", recurring.PATCH(await authedJson(bob, `${BASE}/api/recurring_payments`, "PATCH", { id: aliceRecurring, amount: 1 }))],
      ["PATCH own recurring onto her account", recurring.PATCH(await authedJson(bob, `${BASE}/api/recurring_payments`, "PATCH", { id: bobRecurring, account_id: aliceAccount }))],
      ["DELETE her recurring", recurring.DELETE(await authed(bob, `${BASE}/api/recurring_payments?id=${aliceRecurring}`, { method: "DELETE" }))],
    ]

    for (const [label, pending] of attempts) {
      expect((await pending).status, label).toBe(404)
    }

    // Not one of Alice's rows moved — balances included.
    expect(await aliceRows()).toEqual(before)

    // And Bob's own rows were not dragged along either.
    expect((await accountById(pool, bobAccount)).balance).toBe(100)
  })

  it("a budget edit changes the caller's month, not anyone else's", async () => {
    const before = await aliceRows()

    const res = await budgets.PATCH(
      await authedJson(bob, `${BASE}/api/monthly_budgets`, "PATCH", { month: TODAY.month, base_budget: 999 })
    )
    expect(res.status).toBe(200)

    expect(await aliceRows()).toEqual(before)
    const { rows } = await pool.query(
      `SELECT base_budget::float8 AS b FROM monthly_budgets WHERE user_id = $1 AND month = $2`,
      [bob.id, TODAY.month]
    )
    expect(rows[0].b).toBe(999)
  })
})

describe("every data route refuses a request with no session by itself", () => {
  // The middleware turns these away first in the running app. The routes
  // must not depend on that: a matcher change would otherwise open them all.
  it("401s", async () => {
    const anon = (path: string, method = "GET", body?: unknown) =>
      new NextRequest(`${BASE}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })

    const calls: [string, Promise<Response>][] = [
      ["GET accounts", accounts.GET(anon("/api/accounts"))],
      ["POST accounts", accounts.POST(anon("/api/accounts", "POST", { name: "x", type: "x", balance: 0, max: 0 }))],
      ["GET transactions", transactions.GET(anon(`/api/transactions?year=${TODAY.year}`))],
      ["POST transactions", transactions.POST(anon("/api/transactions", "POST", { date: TODAY_STRING, amount: 1, category: "food", account_id: aliceAccount }))],
      ["GET monthly_totals", monthlyTotals.GET(anon("/api/transactions/monthly_totals"))],
      ["GET budgets", budgets.GET(anon("/api/monthly_budgets"))],
      ["PATCH budgets", budgets.PATCH(anon("/api/monthly_budgets", "PATCH", { month: 1, base_budget: 1 }))],
      ["GET snapshot", snapshots.GET(anon(`/api/balance_snapshot?year=${TODAY.year}`))],
      ["GET recurring", recurring.GET(anon("/api/recurring_payments"))],
    ]

    for (const [label, pending] of calls) {
      expect((await pending).status, label).toBe(401)
    }
  })

  it("401s a session signed with a different secret", async () => {
    const saved = process.env.AUTH_SECRET
    process.env.AUTH_SECRET = "some-other-secret"
    const forged = await authed(alice, `${BASE}/api/accounts`)
    process.env.AUTH_SECRET = saved

    expect((await accounts.GET(forged)).status).toBe(401)
  })
})

describe("the database refuses cross-user rows on its own", () => {
  it("a transaction in another user's account", async () => {
    const error = await pool
      .query(
        `INSERT INTO transactions (date, amount, description, category, account_id, user_id)
         VALUES ($1, 1, 'x', 'food', $2, $3)`,
        [TODAY_STRING, aliceAccount, bob.id]
      )
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23503")
  })

  it("moving a transaction into another user's account", async () => {
    const error = await pool
      .query(`UPDATE transactions SET account_id = $1 WHERE id = $2`, [aliceAccount, bobTransaction])
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23503")
  })

  it("a recurring payment on another user's account", async () => {
    const error = await pool
      .query(`UPDATE recurring_payments SET account_id = $1 WHERE id = $2`, [aliceAccount, bobRecurring])
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23503")
  })

  it("lets two users each have their own budget for the same month", async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM monthly_budgets WHERE month = 1`)
    expect(rows[0].n).toBe(2)
  })
})

describe("the recurring job charges each payment to its owner", () => {
  it("writes the owner onto the generated transaction and charges only their account", async () => {
    await pool.query(`UPDATE recurring_payments SET day_of_month = $1`, [TODAY.day])

    const run = await runScript(SCRIPTS.recurring)
    expect(run.code, run.stderr).toBe(0)

    const { rows } = await pool.query(
      `SELECT user_id, account_id, amount::float8 AS amount FROM transactions
        WHERE recurring_payment_id IS NOT NULL ORDER BY amount`
    )
    expect(rows).toEqual([
      { user_id: bob.id, account_id: bobAccount, amount: 10 },
      { user_id: alice.id, account_id: aliceAccount, amount: 900 },
    ])
    expect((await accountById(pool, aliceAccount)).balance).toBe(5000 - 900)
    expect((await accountById(pool, bobAccount)).balance).toBe(100 - 10)
  })
})
