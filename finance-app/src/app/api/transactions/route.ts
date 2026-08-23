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
import type { TransactionCreateBody, TransactionUpdateBody } from "@/types/api"

export const runtime = "nodejs"

/**
 * Locks an account row for the duration of the transaction and returns its
 * type. Reading inside the transaction with FOR UPDATE means the credit-account
 * check cannot race a concurrent edit to the account's type.
 */
async function lockAccount(client: PoolClient, accountId: string): Promise<string | null> {
  const result = await client.query(
    `SELECT type FROM accounts WHERE id = $1 FOR UPDATE`,
    [accountId]
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

// Gets transactions for a month, for an account, or both
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const category = searchParams.get("category")
    const account = searchParams.get("account")

    const values: unknown[] = []
    const conditions: string[] = []

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
      // Half-open date range instead of EXTRACT() so idx_transactions_date is used.
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

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""

    // Without ORDER BY this returned unspecified Postgres heap order, so
    // "Latest activity" was really reverse-insertion order and editing a
    // transaction's date did not move its row.
    const result = await pool.query(
      `SELECT * FROM "transactions"${where} ORDER BY date DESC, created_at DESC`,
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
      const accountType = await lockAccount(client, account_id)
      assertIncomeAllowed(category, accountType)

      const deltas = transactionDeltas(category, accountType, parsedAmount)

      const inserted = await client.query(
        `
        INSERT INTO "transactions"
        (date, amount, description, category, created_at, account_id)
        VALUES ($1, $2, $3, $4, NOW(), $5)
        RETURNING *
        `,
        [date, parsedAmount, resolvedDescription, category, account_id]
      )

      // COALESCE because accounts.max was historically nullable with no
      // default, and NULL + anything is NULL — income to such an account used
      // to silently destroy the column.
      const accountUpdate = await client.query(
        `UPDATE accounts
            SET balance = balance + $1,
                max = COALESCE(max, 0) + $2
          WHERE id = $3
        RETURNING *`,
        [deltas.balance, deltas.max, account_id]
      )

      return { transaction: inserted.rows[0], account: accountUpdate.rows[0] }
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
    const body: TransactionUpdateBody = await req.json()
    const { id, date, amount, description, category, account_id } = body

    if (!id) {
      throw new HttpError(400, "Transaction ID is required")
    }

    if (amount !== undefined) requireNumber(amount, "amount")

    const { transaction, accounts } = await withTransaction(async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM "transactions" WHERE id = $1 FOR UPDATE`,
        [id]
      )
      if (existingResult.rowCount === 0) {
        throw new HttpError(404, "Transaction not found")
      }

      const existing = existingResult.rows[0]
      const existingAmount = Number(existing.amount)
      const existingAccountId = existing.account_id

      const newAmount = amount !== undefined ? Number(amount) : existingAmount
      const newCategory = category ?? existing.category
      const newAccountId = account_id ?? existingAccountId

      // Lock both accounts in a stable order so two concurrent edits moving
      // transactions between the same pair of accounts cannot deadlock.
      const accountIds = [...new Set<string>([existingAccountId, newAccountId])].sort()
      const accountTypes = new Map<string, string | null>()
      for (const accountId of accountIds) {
        accountTypes.set(accountId, await lockAccount(client, accountId))
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
        WHERE id = $6
        RETURNING *
        `,
        [
          date ?? null,
          amount !== undefined ? newAmount : null,
          description?.trim() || null,
          category ?? null,
          account_id ?? null,
          id,
        ]
      )

      const updatedAccounts = []

      if (existingAccountId === newAccountId) {
        const result = await client.query(
          `UPDATE accounts
              SET balance = balance + $1,
                  max = COALESCE(max, 0) + $2
            WHERE id = $3
          RETURNING *`,
          [newDeltas.balance - oldDeltas.balance, newDeltas.max - oldDeltas.max, newAccountId]
        )
        updatedAccounts.push(result.rows[0])
      } else {
        // Back the transaction out of the old account, then apply it to the new one.
        const reverted = await client.query(
          `UPDATE accounts
              SET balance = balance - $1,
                  max = COALESCE(max, 0) - $2
            WHERE id = $3
          RETURNING *`,
          [oldDeltas.balance, oldDeltas.max, existingAccountId]
        )
        const applied = await client.query(
          `UPDATE accounts
              SET balance = balance + $1,
                  max = COALESCE(max, 0) + $2
            WHERE id = $3
          RETURNING *`,
          [newDeltas.balance, newDeltas.max, newAccountId]
        )
        updatedAccounts.push(reverted.rows[0], applied.rows[0])
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
    // Accepts ?id= or a JSON body, so the three DELETE routes now share one
    // convention without breaking existing callers.
    const id = await readDeleteId(req)

    const account = await withTransaction(async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM "transactions" WHERE id = $1 FOR UPDATE`,
        [id]
      )
      if (existingResult.rowCount === 0) {
        throw new HttpError(404, "Transaction not found")
      }

      const transaction = existingResult.rows[0]
      const accountType = await lockAccount(client, transaction.account_id)
      const deltas = transactionDeltas(
        transaction.category,
        accountType,
        Number(transaction.amount)
      )

      await client.query(`DELETE FROM "transactions" WHERE id = $1`, [id])

      const accountUpdate = await client.query(
        `UPDATE accounts
            SET balance = balance - $1,
                max = COALESCE(max, 0) - $2
          WHERE id = $3
        RETURNING *`,
        [deltas.balance, deltas.max, transaction.account_id]
      )

      return accountUpdate.rows[0]
    })

    return NextResponse.json({
      message: "Transaction deleted successfully",
      accounts: [serializeAccount(account)],
    })
  } catch (error) {
    return handleRouteError(error, "DELETE /transactions")
  }
}
