import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const runtime = "nodejs"

type TransactionBody = {
  date: string
  amount: number
  description?: string
  category: string
  account_id: string
}

//Gets all transactions from this month or for a specific account
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const monthParam = searchParams.get("month")
    const yearParam = searchParams.get("year")
    const category = searchParams.get("category")
    const account = searchParams.get("account")

    let query = `SELECT * FROM "transactions"`
    const values: any[] = []
    const conditions: string[] = []

    if (account) {
      conditions.push(`account_id = $${values.length + 1}`)
      values.push(account)
    } else {
      if (!monthParam || !yearParam) {
        return NextResponse.json(
          { error: "Month and year are required if no account specified" },
          { status: 400 }
        )
      }

      const month = Number(monthParam)
      const year = Number(yearParam)

      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "Invalid month or year" },
          { status: 400 }
        )
      }

      // Use date range instead of EXTRACT (index friendly)
      const startDate = new Date(year, month - 1, 1)
      const endDate = new Date(year, month, 1)

      conditions.push(`date >= $${values.length + 1} AND date < $${values.length + 2}`)
      values.push(startDate, endDate)
    }

    if (category) {
      conditions.push(`category = $${values.length + 1}`)
      values.push(category)
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ')
    }

    const result = await pool.query(query, values)
    const transactions = result.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
    }))

    return NextResponse.json(transactions)

  } catch (error: any) {
    console.error("GET /transactions error:", error)
    console.error(error)
    console.error(error.message)
    console.error(error.detail)

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}

// Posts a transaction
export async function POST(req: NextRequest) {
  try {
    const body: TransactionBody = await req.json()

    const { date, amount, description, category, account_id } = body

    if (
      !date ||
      amount === undefined ||
      !category ||
      !account_id
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const parsedAmount = Number(amount)

    if (isNaN(parsedAmount)) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      )
    }

    const accountResult = await pool.query(
      `SELECT type FROM accounts WHERE id = $1`,
      [account_id]
    )

    if (accountResult.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const accountType = accountResult.rows[0].type?.toLowerCase()
    if (accountType?.includes('credit') && category.toLowerCase() === 'income') {
      return NextResponse.json(
        { error: 'Credit accounts cannot receive Income transactions' },
        { status: 400 }
      )
    }

    const maxDelta = !accountType?.includes('credit') && category.toLowerCase() === 'income' ? parsedAmount : 0
    const delta = category.toLowerCase() === 'income' ? 0 : -parsedAmount

    await pool.query('BEGIN')

    const result = await pool.query(
      `
      INSERT INTO "transactions"
      (date, amount, description, category, created_at, account_id)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      RETURNING *
      `,
      [date, parsedAmount, description ?? null, category, account_id]
    )

    const accountUpdate = await pool.query(
      `UPDATE accounts SET balance = balance + $1, max = max + $2 WHERE id = $3 RETURNING *`,
      [delta, maxDelta, account_id]
    )

    if (accountUpdate.rowCount === 0) {
      await pool.query('ROLLBACK')
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    await pool.query('COMMIT')

    const newTransaction = {
      ...result.rows[0],
      amount: Number(result.rows[0].amount),
    }
    console.log("POST /transactions created:", newTransaction, "accountUpdated:", accountUpdate.rows[0])

    return NextResponse.json(newTransaction, { status: 201 })

  } catch (error: any) {
    await pool.query('ROLLBACK')
    console.error("POST /transactions error:")
    console.error(error)
    console.error(error.message)
    console.error(error.detail)

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

// Edits an existing transaction
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        const { id, date, amount, description, category, account_id } = body

        if (!id) {
            return NextResponse.json({ error: "Transaction ID is required" }, { status: 400 })
        }

        const existingResult = await pool.query(
            `SELECT * FROM "transactions" WHERE id = $1`,
            [id]
        )

        if (existingResult.rowCount === 0) {
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        const existingTransaction = existingResult.rows[0]
        const existingAmount = Number(existingTransaction.amount)
        const existingCategory = existingTransaction.category
        const existingAccountId = existingTransaction.account_id

        const newAmount = amount !== undefined ? Number(amount) : existingAmount
        if (amount !== undefined && isNaN(newAmount)) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
        }

        const newCategory = category ?? existingCategory
        const newAccountId = account_id ?? existingAccountId

        const existingAccountTypeResult = await pool.query(
          `SELECT type FROM accounts WHERE id = $1`,
          [existingAccountId]
        )

        if (existingAccountTypeResult.rowCount === 0) {
          await pool.query('ROLLBACK')
          return NextResponse.json({ error: 'Account not found' }, { status: 404 })
        }

        const existingAccountType = existingAccountTypeResult.rows[0].type?.toLowerCase()

        const accountResult = await pool.query(
          `SELECT type FROM accounts WHERE id = $1`,
          [newAccountId]
        )

        if (accountResult.rowCount === 0) {
          await pool.query('ROLLBACK')
          return NextResponse.json({ error: 'Account not found' }, { status: 404 })
        }

        const accountType = accountResult.rows[0].type?.toLowerCase()
        if (accountType?.includes('credit') && newCategory.toLowerCase() === 'income') {
          await pool.query('ROLLBACK')
          return NextResponse.json(
            { error: 'Credit accounts cannot receive Income transactions' },
            { status: 400 }
          )
        }

        const oldDelta = existingCategory.toLowerCase() === 'income' ? 0 : -existingAmount
        const newDelta = newCategory.toLowerCase() === 'income' ? 0 : -newAmount
        const oldMaxDelta = existingCategory.toLowerCase() === 'income' && !existingAccountType?.includes('credit') ? existingAmount : 0
        const newMaxDelta = newCategory.toLowerCase() === 'income' && !accountType?.includes('credit') ? newAmount : 0

        await pool.query('BEGIN')

        const updateResult = await pool.query(
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
                description ?? null,
                category ?? null,
                account_id ?? null,
                id
            ]
        )

        if (updateResult.rowCount === 0) {
            await pool.query('ROLLBACK')
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        if (existingAccountId === newAccountId) {
            const balanceDelta = newDelta - oldDelta
            const maxDelta = newMaxDelta - oldMaxDelta
            await pool.query(
                `UPDATE accounts SET balance = balance + $1, max = max + $2 WHERE id = $3 RETURNING *`,
                [balanceDelta, maxDelta, newAccountId]
            )
        } else {
            await pool.query(
                `UPDATE accounts SET balance = balance - $1, max = max - $2 WHERE id = $3 RETURNING *`,
                [oldDelta, oldMaxDelta, existingAccountId]
            )
            await pool.query(
                `UPDATE accounts SET balance = balance + $1, max = max + $2 WHERE id = $3 RETURNING *`,
                [newDelta, newMaxDelta, newAccountId]
            )
        }

        await pool.query('COMMIT')

        const updatedTransaction = {
            ...updateResult.rows[0],
            amount: Number(updateResult.rows[0].amount),
        }

        console.log("PATCH /transactions updated:", updatedTransaction)

        return NextResponse.json(updatedTransaction)
    } catch (error: any) {
        await pool.query('ROLLBACK')
        console.error("PATCH /transactions error:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}

// Deletes a transaction
export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json()
        const { id } = body

        if (!id) {
            return NextResponse.json({ error: "Transaction ID is required" }, { status: 400 })
        }

        const existingResult = await pool.query(
            `SELECT * FROM "transactions" WHERE id = $1`,
            [id]
        )

        if (existingResult.rowCount === 0) {
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        const transaction = existingResult.rows[0]
        const transactionAmount = Number(transaction.amount)
        const transactionDelta = transaction.category.toLowerCase() === 'income' ? 0 : -transactionAmount

        const accountResult = await pool.query(
          `SELECT type FROM accounts WHERE id = $1`,
          [transaction.account_id]
        )

        if (accountResult.rowCount === 0) {
          return NextResponse.json({ error: 'Account not found' }, { status: 404 })
        }

        const accountType = accountResult.rows[0].type?.toLowerCase()
        const maxDelta = transaction.category.toLowerCase() === 'income' && !accountType?.includes('credit')
          ? transactionAmount
          : 0

        await pool.query('BEGIN')

        const deleteResult = await pool.query(
            `
            DELETE FROM "transactions"
            WHERE id = $1
            RETURNING *
            `,
            [id]
        )

        if (deleteResult.rowCount === 0) {
            await pool.query('ROLLBACK')
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        await pool.query(
            `UPDATE accounts SET balance = balance - $1, max = max - $2 WHERE id = $3 RETURNING *`,
            [transactionDelta, maxDelta, transaction.account_id]
        )

        await pool.query('COMMIT')

        console.log("DELETE /transactions removed:", transaction)

        return NextResponse.json({ message: "Transaction deleted successfully" })
    } catch (error: any) {
        await pool.query('ROLLBACK')
        console.error("DELETE /transactions error:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)
        
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}