/**
 * Row builders for the integration tests. Deliberately thin: each test states
 * the numbers it depends on rather than inheriting them from a shared seed.
 */
import type { Pool, PoolClient } from "pg"

type Queryable = Pool | PoolClient

export async function createAccount(
  db: Queryable,
  { name, type, balance = 0, max = 0 }: {
    name: string
    type: string
    balance?: number
    max?: number
  }
): Promise<{ id: string }> {
  const { rows } = await db.query(
    `INSERT INTO accounts (name, type, balance, max) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, type, balance, max]
  )
  return rows[0]
}

export async function createBudget(db: Queryable, month: number, baseBudget: number) {
  await db.query(
    `INSERT INTO monthly_budgets (month, base_budget) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET base_budget = EXCLUDED.base_budget`,
    [month, baseBudget]
  )
}

export async function createSnapshot(
  db: Queryable,
  { month, year, startingBalance, endingBalance = null }: {
    month: number
    year: number
    startingBalance: number
    endingBalance?: number | null
  }
) {
  await db.query(
    `INSERT INTO monthly_balance_snapshot (month, year, starting_balance, ending_balance)
     VALUES ($1, $2, $3, $4)`,
    [month, year, startingBalance, endingBalance]
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
    `INSERT INTO recurring_payments (amount, day_of_month, account_id, category, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [amount, dayOfMonth, accountId, category, description]
  )
  return rows[0]
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
