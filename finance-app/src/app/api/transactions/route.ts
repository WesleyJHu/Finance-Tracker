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

//Gets all transactions from this month
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const monthParam = searchParams.get("month")
    const yearParam = searchParams.get("year")
    const category = searchParams.get("category")

    if (!monthParam || !yearParam) {
      return NextResponse.json(
        { error: "Month and year are required" },
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

    let query = `
      SELECT *
      FROM "transactions"
      WHERE date >= $1 AND date < $2
    `

    const values: any[] = [startDate, endDate]

    if (category) {
      query += ` AND category = $3`
      values.push(category)
    }

    const result = await pool.query(query, values)

    return NextResponse.json(result.rows)

  } catch (error) {
    console.error("GET /transactions error:", error)

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

    const result = await pool.query(
      `
      INSERT INTO "transactions"
      (date, amount, description, category, created_at, account_id)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      RETURNING *
      `,
      [date, parsedAmount, description ?? null, category, account_id]
    )

    return NextResponse.json(result.rows[0], { status: 201 })

  } catch (error) {
    console.error("POST /transactions error:", error)

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}

// Edits an existing transaction
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        const { id, date, amount, description, category } = body

        if (!id) {
            return NextResponse.json({ error: "Transaction ID is required" }, { status: 400 })
        }

        const parsedAmount = amount !== undefined ? Number(amount) : undefined

        if (amount !== undefined && isNaN(parsedAmount!)) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
        }

        const result = await pool.query(
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
                parsedAmount ?? null,
                description ?? null,
                category ?? null,
                body.account_id ?? null,
                id
            ]
        )

        if (result.rowCount === 0) {
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        return NextResponse.json(result.rows[0])
    } catch (error) {
        console.error("PATCH /transactions error:", error)
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
        const result = await pool.query(
            `
            DELETE FROM "transactions"
            WHERE id = $1
            RETURNING *
            `,
            [id]
        )

        if (result.rowCount === 0) {
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
        }

        return NextResponse.json({ message: "Transaction deleted successfully" })
    } catch (error) {
        console.error("DELETE /transactions error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}