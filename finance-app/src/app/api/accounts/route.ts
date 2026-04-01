import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = "nodejs"

type AccountBody = {
    name: string
    type: string
    balance: number
}

//Gets all accounts
export async function GET() {
    try {
        const result = await pool.query('SELECT * FROM accounts');
        return NextResponse.json(result.rows);
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
        const { name, type, balance } = body

        if (!name || !type || balance === undefined) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            )
        }
        const parsedBalance = Number(balance)

        if (isNaN(parsedBalance)) {
            return NextResponse.json(
                { error: "Invalid balance" },
                { status: 400 }
            )
        }
        const result = await pool.query(
            'INSERT INTO accounts (name, type, balance) VALUES ($1, $2, $3) RETURNING *',
            [name, type, parsedBalance]
        )
        return NextResponse.json(result.rows[0], { status: 201 })
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
        const { id, name, type, balance } = body

        if (!id) {
            return NextResponse.json(
                { error: "Missing account ID" },
                { status: 400 }
            )
        }

        const parsedBalance = balance !== undefined ? Number(balance) : undefined

        if (parsedBalance !== undefined && isNaN(parsedBalance)) {
            return NextResponse.json(
                { error: "Invalid balance" },
                { status: 400 }
            )
        }
        
        const result = await pool.query(
            `
            UPDATE accounts
            SET name = COALESCE($1, name),
                type = COALESCE($2, type),
                balance = COALESCE($3, balance)
            WHERE id = $4
            RETURNING *
        `,
            [name, type, parsedBalance, id]
        )
        
        if (result.rows.length === 0) {
            return NextResponse.json(
                { error: "Account not found" },
                { status: 404 }
            )
        }
        return NextResponse.json(result.rows[0])
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