/**
 * Row builders for the integration tests. Deliberately thin: each test states
 * the numbers it depends on rather than inheriting them from a shared seed.
 *
 * Every row belongs to a user. Rows that hang off an account (transactions,
 * recurring payments) take their user from that account, as the app does —
 * the composite foreign keys refuse anything else.
 */
import type { Pool, PoolClient } from "pg"
import type { TestUser } from "./session"

type Queryable = Pool | PoolClient

let userCounter = 0

export async function createUser(
  db: Queryable,
  { email, googleSub }: { email?: string; googleSub?: string | null } = {}
): Promise<TestUser> {
  userCounter++
  const { rows } = await db.query(
    `INSERT INTO users (email, google_sub) VALUES ($1, $2) RETURNING id, email`,
    [
      email ?? `user${userCounter}@example.com`,
      googleSub === undefined ? `google-sub-${userCounter}` : googleSub,
    ]
  )
  return rows[0]
}

export async function createAccount(
  db: Queryable,
  { userId, name, type, balance = 0, max = 0 }: {
    userId: string
    name: string
    type: string
    balance?: number
    max?: number
  }
): Promise<{ id: string }> {
  const { rows } = await db.query(
    `INSERT INTO accounts (user_id, name, type, balance, max) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, name, type, balance, max]
  )
  return rows[0]
}

export async function createBudget(db: Queryable, userId: string, month: number, baseBudget: number) {
  await db.query(
    `INSERT INTO monthly_budgets (user_id, month, base_budget) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, month) DO UPDATE SET base_budget = EXCLUDED.base_budget`,
    [userId, month, baseBudget]
  )
}

export async function createSnapshot(
  db: Queryable,
  { userId, month, year, startingBalance, endingBalance = null }: {
    userId: string
    month: number
    year: number
    startingBalance: number
    endingBalance?: number | null
  }
) {
  await db.query(
    `INSERT INTO monthly_balance_snapshot (user_id, month, year, starting_balance, ending_balance)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, month, year, startingBalance, endingBalance]
  )
}

export async function createRecurringPayment(
  db: Queryable,
  { amount, dayOfMonth, accountId, category, description = null }: {
    amount: number
    dayOfMonth: number
    accountId: string
    category: string
    description?: string | null
  }
): Promise<{ id: number }> {
  const { rows } = await db.query(
    `INSERT INTO recurring_payments (amount, day_of_month, account_id, category, description, user_id)
     SELECT $1, $2, a.id, $3, $4, a.user_id FROM accounts a WHERE a.id = $5
     RETURNING id`,
    [amount, dayOfMonth, category, description, accountId]
  )
  if (rows.length === 0) throw new Error(`createRecurringPayment: no account ${accountId}`)
  return rows[0]
}

/**
 * A transaction row written directly, bypassing the API — so the account's
 * balance is NOT adjusted. For tests that need history to exist, not tests of
 * the write path.
 */
export async function insertTransaction(
  db: Queryable,
  { accountId, date, amount, category, description = "x" }: {
    accountId: string
    date: string
    amount: number
    category: string
    description?: string
  }
) {
  const { rowCount } = await db.query(
    `INSERT INTO transactions (date, amount, description, category, account_id, user_id)
     SELECT $1, $2, $3, $4, a.id, a.user_id FROM accounts a WHERE a.id = $5`,
    [date, amount, description, category, accountId]
  )
  if (rowCount === 0) throw new Error(`insertTransaction: no account ${accountId}`)
}

export async function accountById(db: Queryable, id: string) {
  const { rows } = await db.query(
    `SELECT name, type, balance::float8 AS balance, max::float8 AS max, archived
       FROM accounts WHERE id = $1`,
    [id]
  )
  return rows[0] as {
    name: string
    type: string
    balance: number
    max: number
    archived: boolean
  }
}

export async function countTransactions(db: Queryable): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM transactions`)
  return rows[0].n
}
