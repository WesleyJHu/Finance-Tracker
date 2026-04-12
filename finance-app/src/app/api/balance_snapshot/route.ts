import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type BalanceSnapshotBody = {
  starting_balance: number
  ending_balance: number
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
      FROM "balance_snapshots"
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
            typeof ending_balance !== "number" ||
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
            INSERT INTO "balance_snapshots"
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

    if ( !starting_balance || !ending_balance || !month || !year ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const result = await pool.query(
      `
      UPDATE "balance_snapshots"
      SET
        starting_balance = $1,
        ending_balance = $2
      WHERE month = $3 AND year = $4
      RETURNING *
      `,
        [starting_balance, ending_balance, month, year]
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