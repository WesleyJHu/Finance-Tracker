import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import {
  handleRouteError,
  parseMonthYear,
  serializeBalanceSnapshot,
  serializeYearBalanceSummary,
} from "@/lib/api"

export const runtime = "nodejs"

// Gets the balance snapshot for a given month, or a year's starting/ending
// balance when `year` is given without `month`.
//
// `starting_balance` means the previous month's ending balance PLUS that
// month's base budget, so the dashboard must not add the budget again.
// See the header of db/schema.sql.
//
// GET only. The POST and PATCH handlers that used to live here were never
// called by anything — the monthly job writes these rows itself, inside a
// transaction that also closes out the previous month and resets the accounts
// that zero on rollover. An HTTP endpoint that wrote one of those rows in
// isolation could only desynchronise the ledger, so it is gone rather than
// left as a loaded gun.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get("month")
    const yearParam = searchParams.get("year")

    if (yearParam && !monthParam) {
      const year = Number(yearParam)
      if (!Number.isInteger(year)) {
        throw new HttpError(400, "Invalid year")
      }

      // There is no per-year row: a year's starting/ending balance is its
      // January starting_balance and its December ending_balance.
      const result = await pool.query(
        `SELECT month, starting_balance, ending_balance
           FROM "monthly_balance_snapshot"
          WHERE year = $1 AND month IN (1, 12)`,
        [year]
      )
      const startingRow = result.rows.find((row) => row.month === 1)
      const endingRow = result.rows.find((row) => row.month === 12)

      return NextResponse.json(serializeYearBalanceSummary(year, startingRow, endingRow))
    }

    const period = parseMonthYear(searchParams)
    if (!period) {
      throw new HttpError(400, "Month and year are required")
    }

    const result = await pool.query(
      `SELECT * FROM "monthly_balance_snapshot" WHERE month = $1 AND year = $2`,
      [period.month, period.year]
    )

    return NextResponse.json(result.rows.map(serializeBalanceSnapshot))
  } catch (error) {
    return handleRouteError(error, "GET /balance_snapshot")
  }
}
