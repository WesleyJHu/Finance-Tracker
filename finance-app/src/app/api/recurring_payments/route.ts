import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import {
    buildUpdate,
    handleRouteError,
    readDeleteId,
    requireNumber,
    serializeRecurringPayment,
} from "@/lib/api"
import type {
    RecurringPaymentCreateBody,
    RecurringPaymentUpdateBody,
} from "@/types/api"

export const runtime = "nodejs"

const UPDATABLE_COLUMNS = ["amount", "day_of_month", "description", "account_id", "category"] as const

function assertValidAmount(amount: number) {
    if (amount <= 0) throw new HttpError(400, "Invalid amount")
}

function assertValidDayOfMonth(day: number) {
    // The DB CHECK enforces 1-31 too. Days beyond a month's length are clamped
    // at run time by the recurring-payments job, so 31 still fires in February.
    if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new HttpError(400, "Invalid day of month")
    }
}

// Gets all recurring payments
export async function GET() {
    try {
        const result = await pool.query(`SELECT * FROM "recurring_payments" ORDER BY id`)
        return NextResponse.json(result.rows.map(serializeRecurringPayment))
    } catch (error) {
        return handleRouteError(error, "GET /recurring_payments")
    }
}

// Creates a new recurring payment
export async function POST(req: NextRequest) {
    try {
        const body: RecurringPaymentCreateBody = await req.json()
        const { amount, day_of_month, description, account_id, category } = body

        // Explicit presence checks rather than falsy ones, consistent with
        // monthly_budgets: a falsy check rejects legitimate zero values.
        if (amount === undefined || day_of_month === undefined || !account_id || !category) {
            throw new HttpError(400, "Amount, day of month, account_id, and category are required")
        }

        const parsedAmount = requireNumber(amount, "amount")
        assertValidAmount(parsedAmount)

        const parsedDay = requireNumber(day_of_month, "day of month")
        assertValidDayOfMonth(parsedDay)

        const result = await pool.query(
            `
            INSERT INTO "recurring_payments" (amount, day_of_month, description, account_id, category)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `,
            [parsedAmount, parsedDay, description || null, account_id, category]
        )

        return NextResponse.json(serializeRecurringPayment(result.rows[0]), { status: 201 })
    } catch (error) {
        return handleRouteError(error, "POST /recurring_payments")
    }
}

// Updates a recurring payment
export async function PATCH(req: NextRequest) {
    try {
        const body: RecurringPaymentUpdateBody = await req.json()
        const { id, amount, day_of_month, description, account_id, category } = body

        if (!id) {
            throw new HttpError(400, "ID is required")
        }

        let parsedAmount: number | undefined
        if (amount !== undefined) {
            parsedAmount = requireNumber(amount, "amount")
            assertValidAmount(parsedAmount)
        }

        let parsedDay: number | undefined
        if (day_of_month !== undefined) {
            parsedDay = requireNumber(day_of_month, "day of month")
            assertValidDayOfMonth(parsedDay)
        }

        const update = buildUpdate(
            {
                amount: parsedAmount,
                day_of_month: parsedDay,
                description,
                account_id,
                category,
            },
            UPDATABLE_COLUMNS
        )

        if (!update) {
            throw new HttpError(400, "No fields to update")
        }

        const result = await pool.query(
            `
            UPDATE "recurring_payments"
            SET ${update.clause}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${update.values.length + 1}
            RETURNING *
            `,
            [...update.values, id]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Recurring payment not found")
        }

        return NextResponse.json(serializeRecurringPayment(result.rows[0]))
    } catch (error) {
        return handleRouteError(error, "PATCH /recurring_payments")
    }
}

// Deletes a recurring payment
export async function DELETE(req: NextRequest) {
    try {
        const id = await readDeleteId(req)

        const result = await pool.query(
            `DELETE FROM "recurring_payments" WHERE id = $1 RETURNING *`,
            [id]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Recurring payment not found")
        }

        return NextResponse.json({ message: "Recurring payment deleted" })
    } catch (error) {
        return handleRouteError(error, "DELETE /recurring_payments")
    }
}
