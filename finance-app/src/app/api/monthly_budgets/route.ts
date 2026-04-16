import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type MonthlyBudgetBody = {
    month: number
    base_budget: number
}

//Gets monthly budget for a specific month or all if no month specified
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);

        const monthParam = searchParams.get("month")

        let query = `
            SELECT *
            FROM "monthly_budgets"
        `

        const values: any[] = []

        if (monthParam) {
            const month = Number(monthParam)

            if (isNaN(month) || month < 1 || month > 12) {
                return NextResponse.json(
                    { error: "Invalid month" },
                    { status: 400 }
                )
            }

            query += ` WHERE month = $1`
            values.push(month)
        }

        const result = await pool.query(query, values)

        return NextResponse.json(result.rows)
    } catch (error: any) {
        console.error("Error fetching monthly budget:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)

        return NextResponse.json(
            { error: "An error occurred while fetching the monthly budget" },
            { status: 500 }
        )
    }
}


// Updates budget for a specific month
export async function PATCH(req: NextRequest)  {
    try {
        const body: MonthlyBudgetBody = await req.json()

        const { month, base_budget } = body

        if (!month || !base_budget) {
            return NextResponse.json(
                { error: "Month and base budget are required" },
                { status: 400 }
            )
        }

        if (isNaN(month) || month < 1 || month > 12) {
            return NextResponse.json(
                { error: "Invalid month" },
                { status: 400 }
            )
        }

        const result = await pool.query(
            `
            UPDATE "monthly_budgets"
            SET base_budget = $1
            WHERE month = $2
            RETURNING *
        `,
            [base_budget, month]
        )

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: "Monthly budget not found for the specified month" },
                { status: 404 }
            )
        }

        return NextResponse.json(result.rows[0])

    } catch (error: any) {
        console.error("Error updating monthly budget:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)

        return NextResponse.json(
            { error: "An error occurred while updating the monthly budget" },
            { status: 500 }
        )
    }
}