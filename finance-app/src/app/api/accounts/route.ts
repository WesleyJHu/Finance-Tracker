import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import {
  buildUpdate,
  handleRouteError,
  readDeleteId,
  requireNumber,
  serializeAccount,
} from "@/lib/api"
import type { AccountCreateBody, AccountUpdateBody } from "@/types/api"

export const runtime = "nodejs"

const UPDATABLE_COLUMNS = ["name", "type", "balance", "max"] as const

// Gets all accounts
export async function GET(req: NextRequest) {
    try {
        // Archived accounts are hidden everywhere by default. The dashboard,
        // both transaction pickers and the settings modal all read this one
        // endpoint, so they all honour it without further changes.
        const includeArchived =
            new URL(req.url).searchParams.get("includeArchived") === "true"

        // No ORDER BY: card order is unspecified heap order today, and adding
        // one here would visibly reshuffle the dashboard. Left for Phase 4.
        const result = await pool.query(
            includeArchived
                ? "SELECT * FROM accounts"
                : "SELECT * FROM accounts WHERE archived = false"
        )

        return NextResponse.json(result.rows.map(serializeAccount))
    } catch (error) {
        return handleRouteError(error, "GET /accounts")
    }
}

// Creates a new account
export async function POST(req: NextRequest) {
    try {
        const body: AccountCreateBody = await req.json()
        const { name, type, balance, max } = body

        if (!name || !type) {
            throw new HttpError(400, "Name and type are required")
        }

        const parsedBalance = requireNumber(balance, "balance")
        const parsedMax = requireNumber(max, "max")

        const result = await pool.query(
            "INSERT INTO accounts (name, type, balance, max) VALUES ($1, $2, $3, $4) RETURNING *",
            [name, type, parsedBalance, parsedMax]
        )

        return NextResponse.json(serializeAccount(result.rows[0]), { status: 201 })
    } catch (error) {
        return handleRouteError(error, "POST /accounts")
    }
}

// Edits an existing account
export async function PATCH(req: NextRequest) {
    try {
        const body: AccountUpdateBody = await req.json()
        const { id, name, type, balance, max } = body

        if (!id) {
            throw new HttpError(400, "Missing account ID")
        }

        // Only the fields actually supplied are written. The previous
        // COALESCE-everything statement could not distinguish "not supplied"
        // from "set to null".
        const update = buildUpdate(
            {
                name,
                type,
                balance: balance === undefined ? undefined : requireNumber(balance, "balance"),
                max: max === undefined ? undefined : requireNumber(max, "max"),
            },
            UPDATABLE_COLUMNS
        )

        if (!update) {
            throw new HttpError(400, "No fields to update")
        }

        const result = await pool.query(
            `UPDATE accounts SET ${update.clause} WHERE id = $${update.values.length + 1} RETURNING *`,
            [...update.values, id]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Account not found")
        }

        return NextResponse.json(serializeAccount(result.rows[0]))
    } catch (error) {
        return handleRouteError(error, "PATCH /accounts")
    }
}

// Archives an account.
//
// Deliberately not a hard delete. transactions.account_id is NOT NULL, so a
// real DELETE either fails outright or would have to take a year of history
// with it. Archiving hides the account everywhere while leaving its
// transactions intact and still counted in monthly totals.
//
// Kept on the DELETE verb so the client contract is unchanged.
export async function DELETE(req: NextRequest) {
    try {
        const id = await readDeleteId(req)

        const result = await pool.query(
            "UPDATE accounts SET archived = true WHERE id = $1 RETURNING *",
            [id]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Account not found")
        }

        return NextResponse.json({ message: "Account archived successfully" })
    } catch (error) {
        return handleRouteError(error, "DELETE /accounts")
    }
}
