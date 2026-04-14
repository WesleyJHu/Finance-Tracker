import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type AccountBody = {
    name: string
    type: string
    balance: number
    max: number
}

//Gets all accounts
export async function GET() {
    try {
        const result = await pool.query('SELECT * FROM accounts');
        const accounts = result.rows.map((row) => ({
            ...row,
            balance: Number(row.balance),
            max: Number(row.max),
        }))
        return NextResponse.json(accounts);
    } catch (error) {
        console.error("GET /accounts error:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}

//Posts a new account
export async function POST(req: NextRequest) {
    try {
        const body: AccountBody = await req.json();
        const { name, type, balance, max } = body

        if (!name || !type || balance === undefined || max === undefined) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            )
        }
        const parsedBalance = Number(balance)
        const parsedMax = Number(max)

        if (isNaN(parsedBalance) || isNaN(parsedMax)) {
            return NextResponse.json(
                { error: "Invalid balance or max" },
                { status: 400 }
            )
        }
        const result = await pool.query(
            'INSERT INTO accounts (name, type, balance, max) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, type, parsedBalance, parsedMax]
        )
        const newAccount = {
            ...result.rows[0],
            balance: Number(result.rows[0].balance),
            max: Number(result.rows[0].max),
        }
        return NextResponse.json(newAccount, { status: 201 })
    } catch (error: any) {
        console.error("POST /accounts error:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        )
    }
}

//Edits an existing account
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        const { id, name, type, balance, max } = body

        if (!id) {
            return NextResponse.json(
                { error: "Missing account ID" },
                { status: 400 }
            )
        }

        const parsedBalance = balance !== undefined ? Number(balance) : undefined
        const parsedMax = max !== undefined ? Number(max) : undefined

        if (parsedBalance !== undefined && isNaN(parsedBalance)) {
            return NextResponse.json(
                { error: "Invalid balance" },
                { status: 400 }
            )
        }
        if (parsedMax !== undefined && isNaN(parsedMax)) {
            return NextResponse.json(
                { error: "Invalid max" },
                { status: 400 }
            )
        }
        
        const result = await pool.query(
            `
            UPDATE accounts
            SET name = COALESCE($1, name),
                type = COALESCE($2, type),
                balance = COALESCE($3, balance),
                max = COALESCE($4, max)
            WHERE id = $5
            RETURNING *
        `,
            [name, type, parsedBalance, parsedMax, id]
        )
        
        if (result.rows.length === 0) {
            return NextResponse.json(
                { error: "Account not found" },
                { status: 404 }
            )
        }
        const updatedAccount = {
            ...result.rows[0],
            balance: Number(result.rows[0].balance),
            max: Number(result.rows[0].max),
        }
        return NextResponse.json(updatedAccount)
    } catch (error: any) {
        console.error("PATCH /accounts error:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        )
    }
}

//Deletes an account
export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json()
        const { id } = body

        if (!id) {
            return NextResponse.json({ error: "Missing account ID" }, { status: 400 })
        }
        const result = await pool.query(
            `
            DELETE FROM "accounts"
            WHERE id = $1
            RETURNING *
        `,
            [id]
        )

        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Account not found" }, { status: 404 })
        }

        return NextResponse.json({ message: "Account deleted successfully" })
    } catch (error: any) {
        console.error("DELETE /accounts error:", error)
        console.error(error)
        console.error(error.message)
        console.error(error.detail)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}