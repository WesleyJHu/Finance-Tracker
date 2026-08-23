/**
 * P0-2: the recurring-payments job was not idempotent.
 *
 * It checked whether a matching transaction already existed and then inserted
 * one — a check-then-act with no lock, so a container restart, a double cron
 * fire, or a manual re-run double-charged the account. The insert is now
 * guarded by `transactions_recurring_period_uniq` with ON CONFLICT DO NOTHING,
 * and the balance update is skipped when nothing was inserted.
 *
 * The scripts run as real subprocesses, because their exit code is part of
 * what is under test: the old version caught every error and exited 0.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { pool } from "@/lib/db"
import { todayInAppTz, toDateString } from "@/lib/dates"
import { accountById, countTransactions, createAccount, createRecurringPayment } from "./support/fixtures"
import { truncateAll } from "./support/database"
import { runScript, SCRIPTS } from "./support/runScript"

const TODAY = todayInAppTz()
const NOT_TODAY = TODAY.day === 1 ? 2 : 1

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("process-recurring-payments", () => {
  it("applies a payment due today, once", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await createRecurringPayment(pool, {
      amount: 75,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Bills",
      description: "Internet",
    })

    const run = await runScript(SCRIPTS.recurring)
    expect(run.code, run.stderr).toBe(0)

    expect(await countTransactions(pool)).toBe(1)
    expect((await accountById(pool, account.id)).balance).toBe(925)
  })

  it("changes nothing on a second run (P0-2)", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await createRecurringPayment(pool, {
      amount: 75,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Bills",
    })

    await runScript(SCRIPTS.recurring)
    const afterFirst = await accountById(pool, account.id)

    const second = await runScript(SCRIPTS.recurring)
    expect(second.code, second.stderr).toBe(0)
    const third = await runScript(SCRIPTS.recurring)
    expect(third.code, third.stderr).toBe(0)

    // Three runs, one charge. The old code charged three times.
    expect(await countTransactions(pool)).toBe(1)
    expect((await accountById(pool, account.id)).balance).toBe(afterFirst.balance)
    expect(afterFirst.balance).toBe(925)
    expect(second.stdout).toMatch(/already applied/i)
  })

  it("lowercases the Title Case category into the enum's casing", async () => {
    // recurring_payments.category is varchar(50); transactions.category is the
    // enum public."Category", which is lowercase-only. Without the conversion
    // the insert throws outright.
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await createRecurringPayment(pool, {
      amount: 20,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Entertainment",
    })

    const run = await runScript(SCRIPTS.recurring)
    expect(run.code, run.stderr).toBe(0)

    const { rows } = await pool.query(`SELECT category FROM transactions`)
    expect(rows[0].category).toBe("entertainment")
  })

  it("dates the transaction with the ET calendar date, not a UTC instant", async () => {
    // A run after 20:00 ET used to write tomorrow's UTC date, landing the row
    // in the wrong month on the 30th and 31st.
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await createRecurringPayment(pool, {
      amount: 20,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Bills",
    })

    await runScript(SCRIPTS.recurring)

    const { rows } = await pool.query(`SELECT date, period_year, period_month FROM transactions`)
    expect(rows[0].date).toBe(toDateString(TODAY.year, TODAY.month, TODAY.day))
    expect(rows[0].period_year).toBe(TODAY.year)
    expect(rows[0].period_month).toBe(TODAY.month)
  })

  it("leaves a payment due on another day alone", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
    })
    await createRecurringPayment(pool, {
      amount: 75,
      dayOfMonth: NOT_TODAY,
      accountId: account.id,
      category: "Bills",
    })

    const run = await runScript(SCRIPTS.recurring)
    expect(run.code, run.stderr).toBe(0)
    expect(await countTransactions(pool)).toBe(0)
    expect((await accountById(pool, account.id)).balance).toBe(1000)
  })

  it("credits max rather than balance for recurring income", async () => {
    const account = await createAccount(pool, {
      name: "Checking",
      type: "Checking",
      balance: 1000,
      max: 0,
    })
    await createRecurringPayment(pool, {
      amount: 3000,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Income",
    })

    await runScript(SCRIPTS.recurring)

    const after = await accountById(pool, account.id)
    expect(after.balance).toBe(1000)
    expect(after.max).toBe(3000)
  })

  it("exits non-zero when a payment points at a missing account", async () => {
    // The old script caught this and exited 0, so the worker reported success.
    const account = await createAccount(pool, {
      name: "Doomed",
      type: "Checking",
      balance: 1000,
    })
    const payment = await createRecurringPayment(pool, {
      amount: 50,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Bills",
    })

    // Point the payment at an account that does not exist. The FK is
    // deferred-free, so drop it for the duration rather than fight it.
    await pool.query(
      `ALTER TABLE recurring_payments DROP CONSTRAINT IF EXISTS recurring_payments_account_id_fkey`
    )
    await pool.query(
      `UPDATE recurring_payments SET account_id = '00000000-0000-0000-0000-000000000000'
        WHERE id = $1`,
      [payment.id]
    )

    const run = await runScript(SCRIPTS.recurring)
    expect(run.code).not.toBe(0)

    // And the failed payment left nothing behind.
    expect(await countTransactions(pool)).toBe(0)
  })

  it("is protected by a database constraint, not just by application logic", async () => {
    // Belt and braces: even a caller that bypasses the script cannot write two
    // rows for the same payment and period.
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    const payment = await createRecurringPayment(pool, {
      amount: 10,
      dayOfMonth: TODAY.day,
      accountId: account.id,
      category: "Bills",
    })

    const insert = () =>
      pool.query(
        `INSERT INTO transactions
           (date, amount, description, category, account_id,
            recurring_payment_id, period_year, period_month)
         VALUES ($1, 10, 'x', 'bills', $2, $3, 2026, 3)`,
        [toDateString(2026, 3, 1), account.id, payment.id]
      )

    await insert()
    const error = await insert()
      .then(() => null)
      .catch((e) => e as { code?: string })
    expect(error?.code).toBe("23505")
  })
})
