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
import { daysInMonth, previousMonth, todayInAppTz, toDateString } from "@/lib/dates"
import {
  accountById,
  createAccount,
  createBudget,
  createSnapshot,
  createUser,
  insertTransaction,
} from "./support/fixtures"
import { truncateAll } from "./support/database"
import { runScript, SCRIPTS } from "./support/runScript"
import type { TestUser } from "./support/session"

const TODAY = todayInAppTz()
const CURRENT = { year: TODAY.year, month: TODAY.month }
const PREVIOUS = previousMonth(CURRENT)

let user: TestUser

async function snapshotFor(month: number, year: number, owner: TestUser = user) {
  const { rows } = await pool.query(
    `SELECT starting_balance::float8 AS starting_balance,
            ending_balance::float8   AS ending_balance
       FROM monthly_balance_snapshot WHERE user_id = $1 AND month = $2 AND year = $3`,
    [owner.id, month, year]
  )
  return rows[0] as { starting_balance: number; ending_balance: number | null } | undefined
}

async function snapshotCount() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM monthly_balance_snapshot`)
  return rows[0].n as number
}

beforeEach(async () => {
  await truncateAll(pool)
  user = await createUser(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("process-monthly-balance-snapshot", () => {
  it("opens the current month at previous ending + base budget", async () => {
    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createSnapshot(pool, {
      userId: user.id,
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
    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createSnapshot(pool, {
      userId: user.id,
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const account = await createAccount(pool, { userId: user.id, name: "Checking", type: "Checking" })

    const lastMonth = toDateString(PREVIOUS.year, PREVIOUS.month, 15)
    await insertTransaction(pool, { accountId: account.id, date: lastMonth, amount: 400, category: "bills" })
    await insertTransaction(pool, { accountId: account.id, date: lastMonth, amount: 250, category: "income" })

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
    await createBudget(pool, user.id, CURRENT.month, 2000)
    const checking = await createAccount(pool, {
      userId: user.id,
      name: "Checking",
      type: "Checking",
      balance: 600,
    })
    const savings = await createAccount(pool, {
      userId: user.id,
      name: "Savings",
      type: "Savings",
      balance: 5000,
    })

    await insertTransaction(pool, {
      accountId: checking.id,
      date: toDateString(PREVIOUS.year, PREVIOUS.month, 15),
      amount: 400,
      category: "bills",
    })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    expect((await accountById(pool, checking.id)).balance).toBe(600)
    expect((await accountById(pool, savings.id)).balance).toBe(5000)
  })

  it("zeroes credit and brokerage accounts, matching by substring", async () => {
    // The old rule was `type === 'credit'` exactly, which never matched
    // "Credit Card" — the literal placeholder in the create-account form.
    await createBudget(pool, user.id, CURRENT.month, 2000)
    const amex = await createAccount(pool, {
      userId: user.id,
      name: "Amex",
      type: "Credit Card",
      balance: -450,
      max: 5000,
    })
    const broker = await createAccount(pool, {
      userId: user.id,
      name: "Fidelity",
      type: "Brokerage",
      balance: 1200,
    })
    const checking = await createAccount(pool, {
      userId: user.id,
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
    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createSnapshot(pool, {
      userId: user.id,
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const checking = await createAccount(pool, {
      userId: user.id,
      name: "Checking",
      type: "Checking",
      balance: 600,
    })
    const amex = await createAccount(pool, {
      userId: user.id,
      name: "Amex",
      type: "Credit Card",
      balance: -450,
      max: 5000,
    })
    await insertTransaction(pool, {
      accountId: checking.id,
      date: toDateString(PREVIOUS.year, PREVIOUS.month, 15),
      amount: 400,
      category: "bills",
    })

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
    await createBudget(pool, user.id, CURRENT.month, 2000)

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
    // Names whose rollover failed, now that there is more than one ledger.
    expect(run.stderr).toContain(user.email)
  })

  it("rolls back everything when the run fails partway", async () => {
    // The budget lookup throws after the previous month has already been
    // closed out, so the whole run must roll back rather than leave a
    // half-updated ledger.
    await createSnapshot(pool, {
      userId: user.id,
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const amex = await createAccount(pool, {
      userId: user.id,
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
      userId: user.id,
      month: CURRENT.month,
      year: CURRENT.year,
      startingBalance: 100,
    })
    const error = await createSnapshot(pool, {
      userId: user.id,
      month: CURRENT.month,
      year: CURRENT.year,
      startingBalance: 200,
    })
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23505")
  })
})

describe("process-monthly-balance-snapshot: more than one user", () => {
  it("rolls each user's ledger over from their own numbers only", async () => {
    const other = await createUser(pool)

    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createBudget(pool, other.id, CURRENT.month, 500)
    await createSnapshot(pool, { userId: user.id, month: PREVIOUS.month, year: PREVIOUS.year, startingBalance: 1000 })
    await createSnapshot(pool, { userId: other.id, month: PREVIOUS.month, year: PREVIOUS.year, startingBalance: 300 })

    const mine = await createAccount(pool, { userId: user.id, name: "Checking", type: "Checking" })
    const theirs = await createAccount(pool, { userId: other.id, name: "Checking", type: "Checking" })
    const lastMonth = toDateString(PREVIOUS.year, PREVIOUS.month, 15)
    await insertTransaction(pool, { accountId: mine.id, date: lastMonth, amount: 400, category: "bills" })
    await insertTransaction(pool, { accountId: theirs.id, date: lastMonth, amount: 50, category: "food" })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    // 1000 - 400 = 600, then + 2000. The other user's 50 is not in it.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year, user)).toMatchObject({ ending_balance: 600 })
    expect(await snapshotFor(CURRENT.month, CURRENT.year, user)).toMatchObject({ starting_balance: 2600 })

    // 300 - 50 = 250, then + 500.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year, other)).toMatchObject({ ending_balance: 250 })
    expect(await snapshotFor(CURRENT.month, CURRENT.year, other)).toMatchObject({ starting_balance: 750 })
  })

  it("resets only each user's own credit accounts", async () => {
    const other = await createUser(pool)
    await createBudget(pool, user.id, CURRENT.month, 0)
    await createBudget(pool, other.id, CURRENT.month, 0)

    const mine = await createAccount(pool, { userId: user.id, name: "Amex", type: "Credit Card", balance: -100 })
    const theirs = await createAccount(pool, { userId: other.id, name: "Visa", type: "Credit Card", balance: -200 })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    expect((await accountById(pool, mine.id)).balance).toBe(0)
    expect((await accountById(pool, theirs.id)).balance).toBe(0)
  })

  it("still rolls everyone else over when one user's rollover fails", async () => {
    // One transaction per user: a user with no budget row is rolled back and
    // reported, and does not hold anyone else's month hostage.
    const broken = await createUser(pool, { email: "broken@example.com" })
    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createSnapshot(pool, { userId: broken.id, month: PREVIOUS.month, year: PREVIOUS.year, startingBalance: 10 })
    const brokenCard = await createAccount(pool, {
      userId: broken.id,
      name: "Amex",
      type: "Credit Card",
      balance: -450,
    })

    const run = await runScript(SCRIPTS.snapshot)

    expect(run.code).not.toBe(0)
    expect(run.stderr).toContain("broken@example.com")
    expect(run.stderr).not.toContain(user.email)

    // The healthy user rolled over.
    expect(await snapshotFor(CURRENT.month, CURRENT.year, user)).toMatchObject({ starting_balance: 2000 })

    // The broken one was rolled back entirely, card reset included.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year, broken)).toMatchObject({ ending_balance: null })
    expect(await snapshotFor(CURRENT.month, CURRENT.year, broken)).toBeUndefined()
    expect((await accountById(pool, brokenCard.id)).balance).toBe(-450)
  })
})

describe("process-monthly-balance-snapshot: month boundaries", () => {
  it("counts only the previous month's transactions toward its ending balance", async () => {
    // The totals query is a half-open [start, end) range on `date`. An
    // off-by-one at either edge silently moves money between months, and an
    // EXTRACT()-based filter (what this replaced) would also miss the index.
    await createBudget(pool, user.id, CURRENT.month, 2000)
    await createSnapshot(pool, {
      userId: user.id,
      month: PREVIOUS.month,
      year: PREVIOUS.year,
      startingBalance: 1000,
    })
    const account = await createAccount(pool, { userId: user.id, name: "Checking", type: "Checking" })
    const twoMonthsAgo = previousMonth(PREVIOUS)
    const lastDayOfPrevious = daysInMonth(PREVIOUS.year, PREVIOUS.month)

    for (const [date, amount, description] of [
      [toDateString(PREVIOUS.year, PREVIOUS.month, 1), 11, "first day"],
      [toDateString(PREVIOUS.year, PREVIOUS.month, lastDayOfPrevious), 22, "last day"],
      [toDateString(twoMonthsAgo.year, twoMonthsAgo.month, 15), 999, "too old"],
      [toDateString(CURRENT.year, CURRENT.month, 1), 999, "too new"],
    ] as const) {
      await insertTransaction(pool, { accountId: account.id, date, amount, category: "bills", description })
    }

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)

    // Both edges of the month are included; neither neighbour is.
    expect(await snapshotFor(PREVIOUS.month, PREVIOUS.year)).toMatchObject({
      ending_balance: 1000 - 11 - 22,
    })
  })

  it("does not zero an account that is already at zero", async () => {
    // The reset is `WHERE ... AND balance <> 0`, so a no-op run touches no
    // rows at all. This is what makes a re-run cheap as well as safe.
    await createBudget(pool, user.id, CURRENT.month, 2000)
    const amex = await createAccount(pool, { userId: user.id, name: "Amex", type: "Credit Card", balance: 0 })

    const run = await runScript(SCRIPTS.snapshot)
    expect(run.code, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/Reset 0 account\(s\)/)
    expect((await accountById(pool, amex.id)).balance).toBe(0)
  })
})
