import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"

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
      FROM "Transactions"
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
      INSERT INTO "Transactions"
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