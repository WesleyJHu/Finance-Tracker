import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { pool, withTransaction, HttpError } from "@/lib/db"
import { isCreditAccount, isIncome, transactionDeltas } from "@/lib/accounting"
import { monthRange, yearRange } from "@/lib/dates"
import {
  handleRouteError,
  parsePeriod,
  readDeleteId,
  requireNumber,
  serializeAccount,
  serializeTransaction,
} from "@/lib/api"
import { requireUser } from "@/lib/session"
import type { TransactionCreateBody, TransactionUpdateBody } from "@/types/api"

export const runtime = "nodejs"

/**
 * Locks one of the caller's accounts for the duration of the transaction and
 * returns its type. Reading inside the transaction with FOR UPDATE means the
 * credit-account check cannot race a concurrent edit to the account's type.
 *
 * This is also the ownership check for every write below: an account that
 * belongs to someone else is "not found", and nothing is written. The
 * composite foreign key on transactions(account_id, user_id) would refuse the
 * row anyway, but as a 500 rather than a 404.
 */
async function lockAccount(
  client: PoolClient,
  userId: string,
  accountId: string
): Promise<string | null> {
  const result = await client.query(
    `SELECT type FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [accountId, userId]
  )
  if (result.rowCount === 0) {
    throw new HttpError(404, "Account not found")
  }
  return result.rows[0].type
}

function assertIncomeAllowed(category: string, accountType: string | null) {
  if (isIncome(category) && isCreditAccount(accountType)) {
    throw new HttpError(400, "Credit accounts cannot receive Income transactions")
  }
}

/**
 * Applies a balance/max delta to one of the caller's accounts.
 *
 * Always after lockAccount() in the same transaction, which has already
 * established the account is theirs. The user_id filter repeats it, so the
 * statement is safe on its own and not only by virtue of what ran before it.
 */
async function adjustAccount(
  client: PoolClient,
  userId: string,
  accountId: string,
  balanceDelta: number,
  maxDelta: number
) {
  // COALESCE because accounts.max was historically nullable with no default,
  // and NULL + anything is NULL — income to such an account used to silently
  // destroy the column.
  const result = await client.query(
    `UPDATE accounts
        SET balance = balance + $1,
            max = COALESCE(max, 0) + $2
      WHERE id = $3 AND user_id = $4
    RETURNING *`,
    [balanceDelta, maxDelta, accountId, userId]
  )
  return result.rows[0]
}

/** Locks one of the caller's transactions, or 404s. */
async function lockTransaction(client: PoolClient, userId: string, id: string) {
  const result = await client.query(
    `SELECT * FROM "transactions" WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId]
  )
  if (result.rowCount === 0) {
    throw new HttpError(404, "Transaction not found")
  }
  return result.rows[0]
}

// Gets transactions for a month, for an account, or both
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireUser(req)
    const { searchParams } = new URL(req.url)

    const category = searchParams.get("category")
    const account = searchParams.get("account")

    const values: unknown[] = [userId]
    const conditions: string[] = ["user_id = $1"]

    if (account) {
      conditions.push(`account_id = $${values.length + 1}`)
      values.push(account)
    }

    // month/year are now honoured alongside `account` rather than ignored when
    // one is present, so the account modal no longer has to re-filter a full
    // history in the browser. `year` alone (no `month`) is also accepted, for
    // the history tab's year view.
    const period = parsePeriod(searchParams)
    if (period) {
      // Half-open date range instead of EXTRACT() so the (user_id, date)
      // index is used.
      const { start, end } =
        period.kind === "month" ? monthRange(period.year, period.month) : yearRange(period.year)
      conditions.push(`date >= $${values.length + 1} AND date < $${values.length + 2}`)
      values.push(start, end)
    } else if (!account) {
      throw new HttpError(400, "Month and year are required if no account specified")
    }

    if (category) {
      conditions.push(`category = $${values.length + 1}`)
      values.push(category)
    }

    // Without ORDER BY this returned unspecified Postgres heap order, so
    // "Latest activity" was really reverse-insertion order and editing a
    // transaction's date did not move its row.
    const result = await pool.query(
      `SELECT * FROM "transactions" WHERE ${conditions.join(" AND ")}
        ORDER BY date DESC, created_at DESC`,
      values
    )

    return NextResponse.json(result.rows.map(serializeTransaction))
  } catch (error) {
    return handleRouteError(error, "GET /transactions")
  }
}

// Posts a transaction
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireUser(req)
    const body: TransactionCreateBody = await req.json()
    const { date, amount, description, category, account_id } = body

    if (!date || amount === undefined || !category || !account_id) {
      throw new HttpError(400, "Missing required fields")
    }

    const parsedAmount = requireNumber(amount, "amount")

    // transactions.description is NOT NULL in the schema, but this handler used
    // to insert `description ?? null`, so every description-less POST was a
    // guaranteed 500. Fall back to the category name.
    const resolvedDescription = description?.trim() || category

    const { transaction, account } = await withTransaction(async (client) => {
      const accountType = await lockAccount(client, userId, account_id)
      assertIncomeAllowed(category, accountType)

      const deltas = transactionDeltas(category, accountType, parsedAmount)

      const inserted = await client.query(
        `
        INSERT INTO "transactions"
        (user_id, date, amount, description, category, created_at, account_id)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        RETURNING *
        `,
        [userId, date, parsedAmount, resolvedDescription, category, account_id]
      )

      const updated = await adjustAccount(client, userId, account_id, deltas.balance, deltas.max)

      return { transaction: inserted.rows[0], account: updated }
    })

    // `accounts` is returned so the client can stop re-deriving balances
    // locally. Additive: existing callers that read only transaction fields
    // are unaffected.
    return NextResponse.json(
      { ...serializeTransaction(transaction), accounts: [serializeAccount(account)] },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "POST /transactions")
  }
}

// Edits an existing transaction
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireUser(req)
    const body: TransactionUpdateBody = await req.json()
    const { id, date, amount, description, category, account_id } = body

    if (!id) {
      throw new HttpError(400, "Transaction ID is required")
    }

    if (amount !== undefined) requireNumber(amount, "amount")

    const { transaction, accounts } = await withTransaction(async (client) => {
      const existing = await lockTransaction(client, userId, id)
      const existingAmount = Number(existing.amount)
      const existingAccountId = existing.account_id

      const newAmount = amount !== undefined ? Number(amount) : existingAmount
      const newCategory = category ?? existing.category
      const newAccountId = account_id ?? existingAccountId

      // Lock both accounts in a stable order so two concurrent edits moving
      // transactions between the same pair of accounts cannot deadlock. Moving
      // a transaction into an account the caller does not own 404s here.
      const accountIds = [...new Set<string>([existingAccountId, newAccountId])].sort()
      const accountTypes = new Map<string, string | null>()
      for (const accountId of accountIds) {
        accountTypes.set(accountId, await lockAccount(client, userId, accountId))
      }

      const existingAccountType = accountTypes.get(existingAccountId) ?? null
      const newAccountType = accountTypes.get(newAccountId) ?? null

      assertIncomeAllowed(newCategory, newAccountType)

      const oldDeltas = transactionDeltas(existing.category, existingAccountType, existingAmount)
      const newDeltas = transactionDeltas(newCategory, newAccountType, newAmount)

      const updateResult = await client.query(
        `
        UPDATE "transactions"
        SET
            date = COALESCE($1, date),
            amount = COALESCE($2, amount),
            description = COALESCE($3, description),
            category = COALESCE($4, category),
            account_id = COALESCE($5, account_id)
        WHERE id = $6 AND user_id = $7
        RETURNING *
        `,
        [
          date ?? null,
          amount !== undefined ? newAmount : null,
          description?.trim() || null,
          category ?? null,
          account_id ?? null,
          id,
          userId,
        ]
      )

      const updatedAccounts = []

      if (existingAccountId === newAccountId) {
        updatedAccounts.push(
          await adjustAccount(
            client,
            userId,
            newAccountId,
            newDeltas.balance - oldDeltas.balance,
            newDeltas.max - oldDeltas.max
          )
        )
      } else {
        // Back the transaction out of the old account, then apply it to the new one.
        updatedAccounts.push(
          await adjustAccount(client, userId, existingAccountId, -oldDeltas.balance, -oldDeltas.max),
          await adjustAccount(client, userId, newAccountId, newDeltas.balance, newDeltas.max)
        )
      }

      return { transaction: updateResult.rows[0], accounts: updatedAccounts }
    })

    return NextResponse.json({
      ...serializeTransaction(transaction),
      accounts: accounts.map(serializeAccount),
    })
  } catch (error) {
    return handleRouteError(error, "PATCH /transactions")
  }
}

// Deletes a transaction
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireUser(req)
    // Accepts ?id= or a JSON body, so the three DELETE routes now share one
    // convention without breaking existing callers.
    const id = await readDeleteId(req)

    const account = await withTransaction(async (client) => {
      const transaction = await lockTransaction(client, userId, id)
      const accountType = await lockAccount(client, userId, transaction.account_id)
      const deltas = transactionDeltas(
        transaction.category,
        accountType,
        Number(transaction.amount)
      )

      await client.query(`DELETE FROM "transactions" WHERE id = $1 AND user_id = $2`, [id, userId])

      return adjustAccount(client, userId, transaction.account_id, -deltas.balance, -deltas.max)
    })

    return NextResponse.json({
      message: "Transaction deleted successfully",
      accounts: [serializeAccount(account)],
    })
  } catch (error) {
    return handleRouteError(error, "DELETE /transactions")
  }
}
