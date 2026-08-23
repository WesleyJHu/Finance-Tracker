import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import {
  buildUpdate,
  handleRouteError,
  parseMonthYear,
  requireNumber,
  serializeBalanceSnapshot,
} from "@/lib/api"
import type { BalanceSnapshotCreateBody } from "@/types/api"

export const runtime = "nodejs"

const UPDATABLE_COLUMNS = ["starting_balance", "ending_balance"] as const

// Gets the balance snapshot for a given month.
//
// `starting_balance` means the previous month's ending balance PLUS that
// month's base budget, so the dashboard must not add the budget again.
// See the header of db/schema.sql.
export async function GET(req: NextRequest) {
  try {
    const period = parseMonthYear(new URL(req.url).searchParams)
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

// Creates a balance snapshot.
//
// Note: nothing in the app or the scripts currently calls this — the monthly
// job writes these rows with its own SQL. Slated for deletion in Phase 5.
export async function POST(req: NextRequest) {
  try {
    const body: BalanceSnapshotCreateBody = await req.json()
    const { starting_balance, ending_balance, month, year } = body

    const parsedStarting = requireNumber(starting_balance, "starting_balance")
    const parsedMonth = requireNumber(month, "month")
    const parsedYear = requireNumber(year, "year")

    if (parsedMonth < 1 || parsedMonth > 12) {
      throw new HttpError(400, "Invalid month")
    }

    const parsedEnding =
      ending_balance === undefined || ending_balance === null
        ? null
        : requireNumber(ending_balance, "ending_balance")

    // ON CONFLICT rather than a bare insert: (month, year) is unique, and two
    // rows for one period used to be silently possible.
    const result = await pool.query(
      `
      INSERT INTO "monthly_balance_snapshot"
      (starting_balance, ending_balance, month, year)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (month, year) DO UPDATE
        SET starting_balance = EXCLUDED.starting_balance,
            ending_balance   = COALESCE(EXCLUDED.ending_balance, monthly_balance_snapshot.ending_balance)
      RETURNING *
      `,
      [parsedStarting, parsedEnding, parsedMonth, parsedYear]
    )

    return NextResponse.json(serializeBalanceSnapshot(result.rows[0]), { status: 201 })
  } catch (error) {
    return handleRouteError(error, "POST /balance_snapshot")
  }
}

// Updates a balance snapshot. Also currently uncalled; see POST above.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { starting_balance, ending_balance, month, year } = body

    if (month === undefined || year === undefined) {
      throw new HttpError(400, "Month and year are required")
    }

    const update = buildUpdate(
      {
        starting_balance:
          starting_balance === undefined
            ? undefined
            : requireNumber(starting_balance, "starting_balance"),
        ending_balance:
          ending_balance === undefined
            ? undefined
            : requireNumber(ending_balance, "ending_balance"),
      },
      UPDATABLE_COLUMNS
    )

    if (!update) {
      throw new HttpError(
        400,
        "At least one of starting_balance or ending_balance must be provided"
      )
    }

    const result = await pool.query(
      `
      UPDATE "monthly_balance_snapshot"
      SET ${update.clause}
      WHERE month = $${update.values.length + 1} AND year = $${update.values.length + 2}
      RETURNING *
      `,
      [...update.values, Number(month), Number(year)]
    )

    if (result.rowCount === 0) {
      throw new HttpError(404, "Balance snapshot not found")
    }

    return NextResponse.json(serializeBalanceSnapshot(result.rows[0]))
  } catch (error) {
    return handleRouteError(error, "PATCH /balance_snapshot")
  }
}
