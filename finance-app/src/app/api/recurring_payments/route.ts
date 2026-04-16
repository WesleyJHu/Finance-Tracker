import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type RecurringPaymentBody = {
    amount: number
    day_of_month: number
    description?: string
    account_id: string
    category: string
}

//Gets all recurring payments
export async function GET(req: NextRequest) {
    try {
        const result = await pool.query(`
            SELECT *
            FROM "recurring_payments"
            ORDER BY day_of_month
        `)

        return NextResponse.json(result.rows)
    } catch (error: any) {
        console.error("Error fetching recurring payments:", error)
        return NextResponse.json(
            { error: "An error occurred while fetching recurring payments" },
            { status: 500 }
        )
    }
}

// Creates a new recurring payment
export async function POST(req: NextRequest) {
    try {
        const body: RecurringPaymentBody = await req.json()

        const { amount, day_of_month, description, account_id, category } = body

        if (!amount || !day_of_month || !account_id || !category) {
            return NextResponse.json(
                { error: "Amount, day of month, account_id, and category are required" },
                { status: 400 }
            )
        }

        if (isNaN(amount) || amount <= 0) {
            return NextResponse.json(
                { error: "Invalid amount" },
                { status: 400 }
            )
        }

        if (isNaN(day_of_month) || day_of_month < 1 || day_of_month > 31) {
            return NextResponse.json(
                { error: "Invalid day of month" },
                { status: 400 }
            )
        }

        const result = await pool.query(
            `
            INSERT INTO "recurring_payments" (amount, day_of_month, description, account_id, category)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `,
            [amount, day_of_month, description || null, account_id, category]
        )

        return NextResponse.json(result.rows[0], { status: 201 })

    } catch (error: any) {
        console.error("Error creating recurring payment:", error)
        return NextResponse.json(
            { error: "An error occurred while creating the recurring payment" },
            { status: 500 }
        )
    }
}

// Updates a recurring payment
export async function PATCH(req: NextRequest) {
    try {
        const body: RecurringPaymentBody & { id: string } = await req.json()

        const { id, amount, day_of_month, description, account_id, category } = body

        if (!id) {
            return NextResponse.json(
                { error: "ID is required" },
                { status: 400 }
            )
        }

        const updates: string[] = []
        const values: any[] = []
        let paramIndex = 1

        if (amount !== undefined) {
            if (isNaN(amount) || amount <= 0) {
                return NextResponse.json(
                    { error: "Invalid amount" },
                    { status: 400 }
                )
            }
            updates.push(`amount = $${paramIndex++}`)
            values.push(amount)
        }

        if (day_of_month !== undefined) {
            if (isNaN(day_of_month) || day_of_month < 1 || day_of_month > 31) {
                return NextResponse.json(
                    { error: "Invalid day of month" },
                    { status: 400 }
                )
            }
            updates.push(`day_of_month = $${paramIndex++}`)
            values.push(day_of_month)
        }

        if (description !== undefined) {
            updates.push(`description = $${paramIndex++}`)
            values.push(description)
        }

        if (account_id !== undefined) {
            updates.push(`account_id = $${paramIndex++}`)
            values.push(account_id)
        }

        if (category !== undefined) {
            updates.push(`category = $${paramIndex++}`)
            values.push(category)
        }

        if (updates.length === 0) {
            return NextResponse.json(
                { error: "No fields to update" },
                { status: 400 }
            )
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`)

        const query = `
            UPDATE "recurring_payments"
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `
        values.push(id)

        const result = await pool.query(query, values)

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: "Recurring payment not found" },
                { status: 404 }
            )
        }

        return NextResponse.json(result.rows[0])

    } catch (error: any) {
        console.error("Error updating recurring payment:", error)
        return NextResponse.json(
            { error: "An error occurred while updating the recurring payment" },
            { status: 500 }
        )
    }
}

// Deletes a recurring payment
export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id")

        if (!id) {
            return NextResponse.json(
                { error: "ID is required" },
                { status: 400 }
            )
        }

        const result = await pool.query(
            `
            DELETE FROM "recurring_payments"
            WHERE id = $1
            RETURNING *
        `,
            [id]
        )

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: "Recurring payment not found" },
                { status: 404 }
            )
        }

        return NextResponse.json({ message: "Recurring payment deleted" })

    } catch (error: any) {
        console.error("Error deleting recurring payment:", error)
        return NextResponse.json(
            { error: "An error occurred while deleting the recurring payment" },
            { status: 500 }
        )
    }
}