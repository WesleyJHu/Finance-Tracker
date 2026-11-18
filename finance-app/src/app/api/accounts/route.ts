import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError } from "@/lib/db"
import {
  buildUpdate,
  handleRouteError,
  readDeleteId,
  requireNumber,
  serializeAccount,
} from "@/lib/api"
import { requireUser } from "@/lib/session"
import type { AccountCreateBody, AccountUpdateBody } from "@/types/api"

export const runtime = "nodejs"

// Every statement below filters on user_id, including the writes: an id from
// another user's account matches no row and so reads as 404, the same answer
// as an id that does not exist. Saying 403 instead would confirm it exists.

const UPDATABLE_COLUMNS = ["name", "type", "balance", "max"] as const

// Gets all accounts
export async function GET(req: NextRequest) {
    try {
        const { userId } = await requireUser(req)

        // Archived accounts are hidden everywhere by default. The dashboard,
        // both transaction pickers and the settings modal all read this one
        // endpoint, so they all honour it without further changes.
        const includeArchived =
            new URL(req.url).searchParams.get("includeArchived") === "true"

        // No ORDER BY: card order is unspecified heap order today, and adding
        // one here would visibly reshuffle the dashboard. Left for Phase 4.
        const result = await pool.query(
            includeArchived
                ? "SELECT * FROM accounts WHERE user_id = $1"
                : "SELECT * FROM accounts WHERE user_id = $1 AND archived = false",
            [userId]
        )

        return NextResponse.json(result.rows.map(serializeAccount))
    } catch (error) {
        return handleRouteError(error, "GET /accounts")
    }
}

// Creates a new account
export async function POST(req: NextRequest) {
    try {
        const { userId } = await requireUser(req)
        const body: AccountCreateBody = await req.json()
        const { name, type, balance, max } = body

        if (!name || !type) {
            throw new HttpError(400, "Name and type are required")
        }

        const parsedBalance = requireNumber(balance, "balance")
        const parsedMax = requireNumber(max, "max")

        const result = await pool.query(
            "INSERT INTO accounts (user_id, name, type, balance, max) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [userId, name, type, parsedBalance, parsedMax]
        )

        return NextResponse.json(serializeAccount(result.rows[0]), { status: 201 })
    } catch (error) {
        return handleRouteError(error, "POST /accounts")
    }
}

// Edits an existing account
export async function PATCH(req: NextRequest) {
    try {
        const { userId } = await requireUser(req)
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
            `UPDATE accounts SET ${update.clause}
              WHERE id = $${update.values.length + 1} AND user_id = $${update.values.length + 2}
            RETURNING *`,
            [...update.values, id, userId]
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
        const { userId } = await requireUser(req)
        const id = await readDeleteId(req)

        const result = await pool.query(
            "UPDATE accounts SET archived = true WHERE id = $1 AND user_id = $2 RETURNING *",
            [id, userId]
        )

        if (result.rowCount === 0) {
            throw new HttpError(404, "Account not found")
        }

        return NextResponse.json({ message: "Account archived successfully" })
    } catch (error) {
        return handleRouteError(error, "DELETE /accounts")
    }
}
