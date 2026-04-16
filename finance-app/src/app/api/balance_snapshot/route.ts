import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type BalanceSnapshotBody = {
  starting_balance: number
  ending_balance?: number
  month: number
  year: number
}

// Gets balance snapshots for a given month
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const monthParam = searchParams.get("month")
    const yearParam = searchParams.get("year")

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

    const result = await pool.query(
      `
      SELECT *
      FROM "monthly_balance_snapshot"
      WHERE month = $1 AND year = $2
    `,
      [month, year]
    )

    return NextResponse.json(result.rows)
  } catch (error: any) {
    console.error("Error fetching balance snapshots:", error)

    return NextResponse.json(
      { error: "Failed to fetch balance snapshots" },
      { status: 500 }
    )
  }
}

// Posts a balance snapshot for the current month
export async function POST(req: NextRequest) {
    try {
        const body: BalanceSnapshotBody = await req.json()

        const { starting_balance, ending_balance, month, year } = body

        if (
            typeof starting_balance !== "number" ||
            (ending_balance !== undefined && typeof ending_balance !== "number") ||
            typeof month !== "number" ||
            typeof year !== "number" ||
            month < 1 ||
            month > 12
        ) {
            return NextResponse.json(
                { error: "Invalid input data" },
                { status: 400 }
            )
        }

        const result = await pool.query(
            `
            INSERT INTO "monthly_balance_snapshot"
            (starting_balance, ending_balance, month, year)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `,
            [starting_balance, ending_balance, month, year]
        )

        return NextResponse.json(result.rows[0])
    } catch (error: any) {
        console.error("Error creating balance snapshot:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)

        return NextResponse.json(
            { error: "Failed to create balance snapshot" },
            { status: 500 }
        )
    }
}

// Updates a balance snapshot
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { starting_balance, ending_balance, month, year } = body

    if ( !month || !year ) {
      return NextResponse.json(
        { error: "Month and year are required" },
        { status: 400 }
      )
    }

    if (starting_balance === undefined && ending_balance === undefined) {
      return NextResponse.json(
        { error: "At least one of starting_balance or ending_balance must be provided" },
        { status: 400 }
      )
    }

    const updates = []
    const values = []

    if (starting_balance !== undefined) {
      updates.push(`starting_balance = $${updates.length + 1}`)
      values.push(starting_balance)
    }

    if (ending_balance !== undefined) {
      updates.push(`ending_balance = $${updates.length + 1}`)
      values.push(ending_balance)
    }

    values.push(month, year)

    const result = await pool.query(
      `
      UPDATE "monthly_balance_snapshot"
      SET ${updates.join(', ')}
      WHERE month = $${updates.length + 1} AND year = $${updates.length + 2}
      RETURNING *
      `,
        values
    )

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Balance snapshot not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(result.rows[0])
    } catch (error: any) {
        console.error("Error updating balance snapshot:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)

        return NextResponse.json(
            { error: "Failed to update balance snapshot" },
            { status: 500 }
        )
    }
}