import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import { handleRouteError, requireNumber, serializeMonthlyBudget } from "@/lib/api"
import type { MonthlyBudgetUpdateBody } from "@/types/api"

export const runtime = "nodejs"

function assertValidMonth(month: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new HttpError(400, "Invalid month")
    }
}

// Gets the budget for one month, or all 12 rows if no month is given.
//
// There is deliberately no `year`: these are 12 reusable rows shared across
// every year. See the header of db/schema.sql.
export async function GET(req: NextRequest) {
    try {
        const monthParam = new URL(req.url).searchParams.get("month")

        const values: unknown[] = []
        let query = `SELECT * FROM "monthly_budgets"`

        if (monthParam) {
            const month = Number(monthParam)
            assertValidMonth(month)
            query += ` WHERE month = $1`
            values.push(month)
        }

        const result = await pool.query(query, values)
        return NextResponse.json(result.rows.map(serializeMonthlyBudget))
    } catch (error) {
        return handleRouteError(error, "GET /monthly_budgets")
    }
}

// Updates the budget for a specific month
export async function PATCH(req: NextRequest) {
    try {
        const body: MonthlyBudgetUpdateBody = await req.json()
        const { month, base_budget } = body

        // Explicit presence checks, not falsy ones: `!base_budget` rejected a
        // legitimate budget of $0, permanently and silently.
        if (month === undefined || month === null) {
            throw new HttpError(400, "Month is required")
        }
        if (base_budget === undefined || base_budget === null) {
            throw new HttpError(400, "Base budget is required")
        }

        assertValidMonth(Number(month))
        const parsedBudget = requireNumber(base_budget, "base budget")

        const result = await pool.query(
            `
            UPDATE "monthly_budgets"
            SET base_budget = $1
            WHERE month = $2
            RETURNING *
            `,
            [parsedBudget, Number(month)]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Budget not found for that month")
        }

        return NextResponse.json(serializeMonthlyBudget(result.rows[0]))
    } catch (error) {
        return handleRouteError(error, "PATCH /monthly_budgets")
    }
}
