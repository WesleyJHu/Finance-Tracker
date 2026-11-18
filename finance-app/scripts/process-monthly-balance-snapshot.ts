/**
 * Rolls the balance snapshot forward at the start of a new month.
 *
 * For each user: closes out the previous month (writes its ending_balance),
 * opens the current month (writes its starting_balance), then zeroes their
 * accounts that reset monthly.
 *
 * Scheduled at midnight ET on the 1st by worker.mjs. Safe to run by hand at
 * any time: every write is an upsert or an absolute set, so a second run
 * changes nothing.
 *
 * One transaction per user, not one for the whole run. A user whose rollover
 * fails (no budget row for the month, say) is rolled back completely and the
 * rest still roll over; the run then exits non-zero naming who failed, so the
 * worker log shows it. Re-running after fixing it is safe for everyone else,
 * by the idempotency above.
 *
 * starting_balance is DEFINED AS the previous month's ending_balance plus this
 * month's base_budget. src/app/page.tsx depends on that definition and must
 * not add base_budget again. See the header of db/schema.sql.
 */
import type { PoolClient } from "pg"
import { pool, withTransaction } from "@/lib/db"
import { monthEndingBalance, snapshotStartingBalance } from "@/lib/accounting"
import { monthRange, previousMonth, todayInAppTz } from "@/lib/dates"

type Period = { year: number; month: number }
type User = { id: string; email: string }

async function processMonthlyBalanceSnapshot() {
  const today = todayInAppTz()
  const current = { year: today.year, month: today.month }
  // Derived from the ET date, not Date#getMonth(), which resolves in the host
  // timezone and disagreed with the ET month derived four lines earlier.
  const previous = previousMonth(current)

  console.log(`Current month: ${current.month}/${current.year}`)
  console.log(`Previous month: ${previous.month}/${previous.year}`)

  const { rows: users } = await pool.query<User>(`SELECT id, email FROM users ORDER BY created_at, id`)
  console.log(`Rolling over ${users.length} user(s)`)

  const failures: string[] = []

  for (const user of users) {
    try {
      await withTransaction((client) => rollOverUser(client, user, previous, current))
    } catch (error) {
      console.error(`[${user.email}] rollover failed and was rolled back:`, error)
      failures.push(user.email)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Rollover failed for ${failures.length} of ${users.length} user(s): ${failures.join(", ")}`
    )
  }

  console.log("Monthly balance snapshot processing completed successfully")
}

async function rollOverUser(client: PoolClient, user: User, previous: Period, current: Period) {
  const log = (message: string) => console.log(`[${user.email}] ${message}`)

  // ---------------------------------------------------------------
  // 1. Close out the previous month
  // ---------------------------------------------------------------
  const previousRange = monthRange(previous.year, previous.month)

  // Half-open date range instead of EXTRACT(), so the (user_id, date) index is used.
  const totals = await client.query(
    `
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE category = 'income'), 0)  AS income,
      COALESCE(SUM(amount) FILTER (WHERE category <> 'income'), 0) AS expenses
    FROM transactions
    WHERE user_id = $1 AND date >= $2 AND date < $3
    `,
    [user.id, previousRange.start, previousRange.end]
  )

  const previousSnapshot = await client.query(
    `SELECT starting_balance FROM monthly_balance_snapshot
      WHERE user_id = $1 AND month = $2 AND year = $3
      FOR UPDATE`,
    [user.id, previous.month, previous.year]
  )

  // rows[0] used to be dereferenced unguarded, so the very first run always
  // died with a TypeError — 16 lines before the "this might be the first run"
  // message that was supposed to handle it.
  let previousStartingBalance = 0
  if (previousSnapshot.rowCount === 0) {
    log(
      `No snapshot for ${previous.month}/${previous.year} — treating its ` +
        `starting balance as 0. This is expected on the first ever run.`
    )
  } else {
    previousStartingBalance = Number(previousSnapshot.rows[0].starting_balance)
  }

  const previousEndingBalance = monthEndingBalance(
    previousStartingBalance,
    Number(totals.rows[0].income),
    Number(totals.rows[0].expenses)
  )

  log(
    `Previous month: start ${previousStartingBalance.toFixed(2)}, ` +
      `income ${Number(totals.rows[0].income).toFixed(2)}, ` +
      `expenses ${Number(totals.rows[0].expenses).toFixed(2)}, ` +
      `end ${previousEndingBalance.toFixed(2)}`
  )

  if (previousSnapshot.rowCount !== 0) {
    await client.query(
      `UPDATE monthly_balance_snapshot
          SET ending_balance = $1
        WHERE user_id = $2 AND month = $3 AND year = $4`,
      [previousEndingBalance, user.id, previous.month, previous.year]
    )
  }

  // ---------------------------------------------------------------
  // 2. Open the current month
  // ---------------------------------------------------------------
  const budget = await client.query(
    `SELECT base_budget FROM monthly_budgets WHERE user_id = $1 AND month = $2`,
    [user.id, current.month]
  )
  if (budget.rowCount === 0) {
    // Every user gets all 12 rows when they first sign in (src/lib/users.ts),
    // so this means rows were deleted by hand.
    throw new Error(
      `No monthly_budgets row for month ${current.month}. Saving that month's ` +
        `budget in Settings creates it.`
    )
  }

  const baseBudget = Number(budget.rows[0].base_budget)
  const startingBalance = snapshotStartingBalance(previousEndingBalance, baseBudget)

  log(
    `Current month: carryover ${previousEndingBalance.toFixed(2)} + ` +
      `budget ${baseBudget.toFixed(2)} = starting ${startingBalance.toFixed(2)}`
  )

  // Upsert rather than check-then-insert, which was a TOCTOU that could
  // produce two rows for the same period before the unique constraint existed.
  await client.query(
    `
    INSERT INTO monthly_balance_snapshot (user_id, starting_balance, month, year)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, month, year)
    DO UPDATE SET starting_balance = EXCLUDED.starting_balance
    `,
    [user.id, startingBalance, current.month, current.year]
  )

  // ---------------------------------------------------------------
  // 3. Reset the accounts that zero out monthly
  // ---------------------------------------------------------------
  // This deliberately does NOT re-derive balances from transactions. The API
  // already decrements accounts.balance as each transaction is created, so
  // the previous `balance - spent` here subtracted the same spending twice
  // and silently corrupted every non-credit account when run mid-month.
  // Non-credit balances now simply carry forward.
  //
  // Matching is by substring, consistent with the rest of the codebase: the
  // old exact `type = 'credit'` never matched an account typed "Credit Card",
  // which is the literal placeholder shown in the create-account form.
  const reset = await client.query(
    `UPDATE accounts
        SET balance = 0
      WHERE user_id = $1
        AND (type ILIKE '%credit%' OR type ILIKE '%brokerage%')
        AND balance <> 0
    RETURNING name, type`,
    [user.id]
  )

  for (const account of reset.rows) {
    log(`Reset ${account.name} (${account.type}) → 0.00`)
  }
  log(`Reset ${reset.rowCount} account(s)`)
}

processMonthlyBalanceSnapshot()
  .then(() => pool.end())
  .then(() => {
    console.log("Script completed successfully")
    process.exit(0)
  })
  .catch(async (error) => {
    console.error("Monthly balance snapshot processing failed:", error)
    await pool.end().catch(() => {})
    process.exit(1)
  })
