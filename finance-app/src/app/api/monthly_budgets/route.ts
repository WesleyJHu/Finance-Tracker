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

// Sets the budget for a specific month, creating the row if it does not exist.
//
// An upsert rather than a plain UPDATE: the settings grid always renders all 12
// months, so a month with no row yet is editable in the UI but used to 404 on
// save. Nothing checked the response, so the value silently reverted on the
// next load. Postgres has no INSERT-only path here worth exposing separately,
// so PATCH covers both and there is no POST.
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
            INSERT INTO "monthly_budgets" (month, base_budget)
            VALUES ($2, $1)
            ON CONFLICT (month) DO UPDATE SET base_budget = EXCLUDED.base_budget
            RETURNING *
            `,
            [parsedBudget, Number(month)]
        )

        return NextResponse.json(serializeMonthlyBudget(result.rows[0]))
    } catch (error) {
        return handleRouteError(error, "PATCH /monthly_budgets")
    }
}
