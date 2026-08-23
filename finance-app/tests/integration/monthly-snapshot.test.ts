/**
 * P0-3 and P0-6: the monthly snapshot job.
 *
 * P0-3 — it re-derived every non-credit balance as `balance - spent`, but the
 * API already decrements `accounts.balance` as each transaction is created, so
 * a mid-month run subtracted the same spending twice and silently corrupted
 * every bank account. The re-subtraction is gone; only credit and brokerage
 * accounts are zeroed.
 *
 * P0-6 — the first ever run dereferenced `rows[0].starting_balance` with no
 * previous snapshot to read, so it died with a TypeError sixteen lines before
 * the "this might be the first run" message meant to handle exactly that.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { pool } from "@/lib/db"
import { previousMonth, todayInAppTz, toDateString } from "@/lib/dates"
import {
  accountById,
  createAccount,
  createBudget,
  createSnapshot,
} from "./support/fixtures"
import { truncateAll } from "./support/database"
import { runScript, SCRIPTS } from "./support/runScript"

const TODAY = todayInAppTz()
const CURRENT = { year: TODAY.year, month: TODAY.month }
const PREVIOUS = previousMonth(CURRENT)

async function snapshotFor(month: number, year: number) {
  const { rows } = await pool.query(
    `SELECT starting_balance::float8 AS starting_balance,
            ending_balance::float8   AS ending_balance
       FROM monthly_balance_snapshot WHERE month = $1 AND year = $2`,
    [month, year]
  )
  return rows[0] as { starting_balance: number; ending_balance: number | null } | undefined
}

async function snapshotCount() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM monthly_balance_snapshot`)
  return rows[0].n as number
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("process-monthly-balance-snapshot", () => {
  it("opens the current month at previous ending + base budget", async () => {
    await createBudget(pool, CURRENT.month, 2000)
    await createSnapshot(pool, {
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    // No transactions last month, so it ended where it started: 1000.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year)).toMatchObject({
      ending_balance: 1000,
    })
    expect(await snapshotFor(CURRENT.month, CURRENT.year)).toMatchObject({
      starting_balance: 3000,
    })
  })

  it("closes the previous month with its income and expenses", async () => {
    await createBudget(pool, CURRENT.month, 2000)
    await createSnapshot(pool, {
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })

    const lastMonth = toDateString(PREVIOUS.year, PREVIOUS.month, 15)
    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ($1, 400, 'rent', 'bills', $2), ($1, 250, 'pay', 'income', $2)`,
      [lastMonth, account.id]
    )

    await runScript(SCRIPTS.snapshot)

    // 1000 + 250 income - 400 expenses = 850.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year)).toMatchObject({
      ending_balance: 850,
    })
    expect(await snapshotFor(CURRENT.month, CURRENT.year)).toMatchObject({
      starting_balance: 2850,
    })
  })

  it("leaves bank balances untouched — no re-subtraction (P0-3)", async () => {
    // The old code set balance = balance - spent, double-counting spending the
    // API had already applied. A checking account that spent 400 and sat at
    // 600 was rewritten to 200.
    await createBudget(pool, CURRENT.month, 2000)
    const checking = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 600,
    })
    const savings = await createAccount(pool, {
      name: "Savings",
      type: "Savings",
      balance: 5000,
    })

    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ($1, 400, 'rent', 'bills', $2)`,
      [toDateString(PREVIOUS.year, PREVIOUS.month, 15), checking.id]
    )

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    expect((await accountById(pool, checking.id)).balance).toBe(600)
    expect((await accountById(pool, savings.id)).balance).toBe(5000)
  })

  it("zeroes credit and brokerage accounts, matching by substring", async () => {
    // The old rule was `type === 'credit'` exactly, which never matched
    // "Credit Card" — the literal placeholder in the create-account form.
    await createBudget(pool, CURRENT.month, 2000)
    const amex = await createAccount(pool, {
      name: "Amex",
      type: "Credit Card",
      balance: -450,
      max: 5000,
    })
    const broker = await createAccount(pool, {
      name: "Fidelity",
      type: "Brokerage",
      balance: 1200,
    })
    const checking = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 800,
    })

    await runScript(SCRIPTS.snapshot)

    expect((await accountById(pool, amex.id)).balance).toBe(0)
    expect((await accountById(pool, broker.id)).balance).toBe(0)
    expect((await accountById(pool, checking.id)).balance).toBe(800)

    // The credit limit is not a balance and must survive the reset.
    expect((await accountById(pool, amex.id)).max).toBe(5000)
  })

  it("changes nothing on a second or third run (P0-3)", async () => {
    await createBudget(pool, CURRENT.month, 2000)
    await createSnapshot(pool, {
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const checking = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 600,
    })
    const amex = await createAccount(pool, {
      name: "Amex",
      type: "Credit Card",
      balance: -450,
      max: 5000,
    })
    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ($1, 400, 'rent', 'bills', $2)`,
      [toDateString(PREVIOUS.year, PREVIOUS.month, 15), checking.id]
    )

    await runScript(SCRIPTS.snapshot)
    const first = {
      checking: await accountById(pool, checking.id),
      amex: await accountById(pool, amex.id),
      previous: await snapshotFor(PREVIOUS.month, PREVIOUS.year),
      current: await snapshotFor(CURRENT.month, CURRENT.year),
      snapshots: await snapshotCount(),
    }

    const second = await runScript(SCRIPTS.snapshot)
    expect(second.code, second.stderr).toBe(0)
    const third = await runScript(SCRIPTS.snapshot)
    expect(third.code, third.stderr).toBe(0)

    expect(await accountById(pool, checking.id)).toEqual(first.checking)
    expect(await accountById(pool, amex.id)).toEqual(first.amex)
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year)).toEqual(first.previous)
    expect(await snapshotFor(CURRENT.month, CURRENT.year)).toEqual(first.current)

    // And no duplicate period row, which the unique constraint now forbids.
    expect(await snapshotCount()).toBe(first.snapshots)
  })

  it("survives the first ever run with no previous snapshot (P0-6)", async () => {
    await createBudget(pool, CURRENT.month, 2000)

    const run = await runScript(SCRIPTS.snapshot)

    expect(run.code, run.stderr).toBe(0)
    expect(run.stderr).not.toMatch(/TypeError/)
    expect(run.stdout).toMatch(/first ever run/i)

    // A missing previous snapshot is treated as opening at 0.
    expect(await snapshotFor(CURRENT.month, CURRENT.year)).toMatchObject({
      starting_balance: 2000,
    })
  })

  it("fails with a clear message, not a TypeError, when the budget row is missing", async () => {
    // Nothing seeded at all. The old script's failure mode here was an
    // unhandled TypeError and exit code 0.
    const run = await runScript(SCRIPTS.snapshot)

    expect(run.code).not.toBe(0)
    expect(run.stderr).not.toMatch(/TypeError/)
    expect(run.stderr).toMatch(/No monthly_budgets row/i)
    expect(run.stderr).toMatch(/seed\.sql/i)
  })

  it("rolls back everything when the run fails partway", async () => {
    // The budget lookup throws after the previous month has already been
    // closed out, so the whole run must roll back rather than leave a
    // half-updated ledger.
    await createSnapshot(pool, {
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const amex = await createAccount(pool, {
      name: "Amex",
      type: "Credit Card",
      balance: -450,
    })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code).not.toBe(0)

    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year)).toMatchObject({
      ending_balance: null,
    })
    expect(await snapshotFor(CURRENT.month, CURRENT.year)).toBeUndefined()
    expect((await accountById(pool, amex.id)).balance).toBe(-450)
  })

  it("rejects a duplicate period row at the database level (P0-10)", async () => {
    await createSnapshot(pool, {
      month: CURRENT.month,
      year: CURRENT.year,
      startingBalance: 100,
    })
    const error = await createSnapshot(pool, {
      month: CURRENT.month,
      year: CURRENT.year,
      startingBalance: 200,
    })
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23505")
  })
})
