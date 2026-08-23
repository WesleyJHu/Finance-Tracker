import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import { handleRouteError } from "@/lib/api"
import { monthRange, previousMonth, todayInAppTz } from "@/lib/dates"
import type { MonthlyTotal } from "@/types/api"

export const runtime = "nodejs"

const DEFAULT_MONTHS = 6
const MAX_MONTHS = 24

// Income and expense totals per month, oldest first, for the dashboard's
// spending chart.
//
// The chart used to be six hardcoded `<div>`s on a fixed height ladder
// (h-20 through h-40) that never changed no matter what the data said.
//
// Months with no transactions are returned as zeroes rather than omitted, so
// the caller always gets exactly `months` entries and the bars stay evenly
// spaced.
export async function GET(req: NextRequest) {
  try {
    const monthsParam = new URL(req.url).searchParams.get("months")
    const months = monthsParam === null ? DEFAULT_MONTHS : Number(monthsParam)

    if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
      throw new HttpError(400, `months must be an integer between 1 and ${MAX_MONTHS}`)
    }

    const today = todayInAppTz()

    // Walk back from the current month so the window is derived in the app's
    // timezone, not the database server's.
    const periods: { year: number; month: number }[] = []
    let cursor = { year: today.year, month: today.month }
    for (let i = 0; i < months; i++) {
      periods.unshift(cursor)
      cursor = previousMonth(cursor)
    }

    const start = monthRange(periods[0].year, periods[0].month).start
    const end = monthRange(periods[periods.length - 1].year, periods[periods.length - 1].month).end

    // Half-open range on a bare date column, so idx_transactions_date is used.
    const { rows } = await pool.query(
      `
      SELECT
        EXTRACT(YEAR  FROM date)::int AS year,
        EXTRACT(MONTH FROM date)::int AS month,
        COALESCE(SUM(amount) FILTER (WHERE category =  'income'), 0)::float8 AS income,
        COALESCE(SUM(amount) FILTER (WHERE category <> 'income'), 0)::float8 AS expenses
      FROM transactions
      WHERE date >= $1 AND date < $2
      GROUP BY 1, 2
      `,
      [start, end]
    )

    const byPeriod = new Map(
      rows.map((row) => [`${row.year}-${row.month}`, row as MonthlyTotal])
    )

    const totals: MonthlyTotal[] = periods.map(
      (period) =>
        byPeriod.get(`${period.year}-${period.month}`) ?? {
          year: period.year,
          month: period.month,
          income: 0,
          expenses: 0,
        }
    )

    return NextResponse.json(totals)
  } catch (error) {
    return handleRouteError(error, "GET /transactions/monthly_totals")
  }
}
