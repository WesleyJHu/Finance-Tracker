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