/**
 * Applies every recurring payment that is due today.
 *
 * Scheduled daily at midnight ET by worker.mjs. Safe to run by hand at any
 * time: a payment already applied for the current month is skipped.
 */
import { pool, withTransaction } from "@/lib/db"
import { transactionDeltas } from "@/lib/accounting"
import { daysInMonth, todayInAppTz, toDateString } from "@/lib/dates"

type RecurringPayment = {
  id: number
  amount: string
  day_of_month: number
  description: string | null
  account_id: string | null
  category: string
}

async function processRecurringPayments() {
  const today = todayInAppTz()
  const monthLength = daysInMonth(today.year, today.month)

  console.log(
    `Processing recurring payments for ${today.year}-${today.month}-${today.day} (ET)`
  )

  const { rows: payments } = await pool.query<RecurringPayment>(
    `SELECT id, amount, day_of_month, description, account_id, category
       FROM recurring_payments
      ORDER BY id`
  )

  console.log(`Found ${payments.length} recurring payments`)

  let applied = 0
  let skipped = 0

  for (const payment of payments) {
    // Clamp to the length of this month, so a payment set to the 31st still
    // fires in February rather than silently never firing.
    const dueDay = Math.min(payment.day_of_month, monthLength)
    if (dueDay !== today.day) continue

    if (!payment.account_id) {
      console.warn(`Payment ${payment.id} has no account_id, skipping`)
      skipped++
      continue
    }

    const wasApplied = await applyPayment(payment, today)
    if (wasApplied) {
      applied++
    } else {
      skipped++
      console.log(`Payment ${payment.id} already applied for this month, skipping`)
    }
  }

  console.log(`Applied ${applied} recurring payments, skipped ${skipped}`)
}

async function applyPayment(
  payment: RecurringPayment,
  today: { year: number; month: number; day: number }
): Promise<boolean> {
  const amount = Number(payment.amount)
  // recurring_payments.category is varchar in Title Case, but
  // transactions.category is the lowercase enum public."Category" — this
  // lowercasing is load-bearing, not cosmetic. Without it the insert throws.
  const category = payment.category.toLowerCase()

  return withTransaction(async (client) => {
    // ON CONFLICT DO NOTHING against transactions_recurring_period_uniq is what
    // makes this job idempotent. It is an atomic guard, not a check-then-act:
    // a second run inserts nothing and therefore skips the balance update, so
    // a container restart or a double cron fire cannot double-charge.
    const inserted = await client.query(
      `
      INSERT INTO transactions
        (date, amount, description, category, account_id,
         recurring_payment_id, period_year, period_month)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (recurring_payment_id, period_year, period_month)
        WHERE recurring_payment_id IS NOT NULL
        DO NOTHING
      RETURNING *
      `,
      [
        // Dated from the ET calendar date, not now.toISOString(): a run after
        // 20:00 ET would otherwise write tomorrow's UTC date and land the row
        // in the wrong month on the 30th/31st.
        toDateString(today.year, today.month, today.day),
        amount,
        payment.description || `${payment.category} (Recurring)`,
        category,
        payment.account_id,
        payment.id,
        today.year,
        today.month,
      ]
    )

    if (inserted.rowCount === 0) return false

    const accountResult = await client.query(
      `SELECT type FROM accounts WHERE id = $1 FOR UPDATE`,
      [payment.account_id]
    )
    if (accountResult.rowCount === 0) {
      throw new Error(
        `Payment ${payment.id} references account ${payment.account_id}, which does not exist`
      )
    }

    const deltas = transactionDeltas(category, accountResult.rows[0].type, amount)

    // Relative update, not SELECT-then-SET: the previous read-modify-write lost
    // any balance change the API made in between.
    const updated = await client.query(
      `UPDATE accounts
          SET balance = balance + $1,
              max = COALESCE(max, 0) + $2
        WHERE id = $3
      RETURNING name, balance`,
      [deltas.balance, deltas.max, payment.account_id]
    )

    console.log(
      `Applied payment ${payment.id} (${category}, ${amount}) to ` +
        `${updated.rows[0].name} → ${updated.rows[0].balance}`
    )

    return true
  })
}

processRecurringPayments()
  .then(() => pool.end())
  .then(() => {
    console.log("Recurring payments processing completed")
    process.exit(0)
  })
  .catch(async (error) => {
    // The previous version swallowed this and exited 0, so the worker could
    // never observe a failure.
    console.error("Recurring payments processing failed:", error)
    await pool.end().catch(() => {})
    process.exit(1)
  })
