import { NextRequest, NextResponse } from "next/server"
import { pool, HttpError, withTransaction } from "@/lib/db"
import { handleRouteError, requireNumber, serializeMonthlyBudget } from "@/lib/api"
import { snapshotStartingBalance } from "@/lib/accounting"
import { previousMonth, todayInAppTz } from "@/lib/dates"
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
        const targetMonth = Number(month)

        const row = await withTransaction(async (client) => {
            // Read the old budget under a row lock before overwriting it: the
            // snapshot below moves by the difference, and reading it after the
            // upsert would only ever see the new value. FOR UPDATE serializes
            // two concurrent edits of the same month, so the two deltas cannot
            // both be computed against the same starting point.
            const before = await client.query(
                `SELECT base_budget FROM "monthly_budgets" WHERE month = $1 FOR UPDATE`,
                [targetMonth]
            )
            const previousBaseBudget = Number(before.rows[0]?.base_budget ?? 0)

            const result = await client.query(
                `
                INSERT INTO "monthly_budgets" (month, base_budget)
                VALUES ($2, $1)
                ON CONFLICT (month) DO UPDATE SET base_budget = EXCLUDED.base_budget
                RETURNING *
                `,
                [parsedBudget, targetMonth]
            )

            await applyBudgetChangeToSnapshot(
                client,
                targetMonth,
                previousBaseBudget,
                parsedBudget
            )

            return result.rows[0]
        })

        return NextResponse.json(serializeMonthlyBudget(row))
    } catch (error) {
        return handleRouteError(error, "PATCH /monthly_budgets")
    }
}

/**
 * Keeps `monthly_balance_snapshot.starting_balance` in step with an edited
 * base budget.
 *
 * `starting_balance` is DEFINED AS the previous month's ending balance plus
 * this month's base budget, and the dashboard's Remaining Budget reads it
 * directly (see src/lib/accounting.ts). But it is only ever written by the
 * snapshot job, at midnight on the 1st. Editing this month's budget after that
 * left the snapshot holding the old budget, so Remaining Budget did not move
 * at all — the symptom that a freshly entered base budget appeared to be
 * ignored.
 *
 * Only the current month is touched. Past months are closed history, and a
 * future month has no snapshot to correct: the job will fold the new budget in
 * when it opens that month.
 */
async function applyBudgetChangeToSnapshot(
    client: { query: typeof pool.query },
    month: number,
    previousBaseBudget: number,
    newBaseBudget: number
) {
    const today = todayInAppTz()
    if (month !== today.month) return

    const delta = newBaseBudget - previousBaseBudget
    const existing = await client.query(
        `SELECT starting_balance FROM monthly_balance_snapshot
          WHERE month = $1 AND year = $2
          FOR UPDATE`,
        [today.month, today.year]
    )

    if (existing.rowCount !== 0) {
        // Shifted by the delta rather than recomputed from the previous month:
        // the carryover already baked into starting_balance is the one the job
        // computed, and re-deriving it here could disagree with it.
        if (delta === 0) return
        await client.query(
            `UPDATE monthly_balance_snapshot
                SET starting_balance = starting_balance + $1
              WHERE month = $2 AND year = $3`,
            [delta, today.month, today.year]
        )
        return
    }

    // No snapshot for this month yet — the job has not run since the month
    // turned over. Open the month here so the budget is visible immediately,
    // carrying over the previous month's ending balance if it has been closed
    // out. The job's own upsert overwrites this with the same definition.
    const previous = previousMonth({ year: today.year, month: today.month })
    const carryover = await client.query(
        `SELECT ending_balance FROM monthly_balance_snapshot
          WHERE month = $1 AND year = $2`,
        [previous.month, previous.year]
    )
    const previousEndingBalance = Number(carryover.rows[0]?.ending_balance ?? 0)

    await client.query(
        `
        INSERT INTO monthly_balance_snapshot (starting_balance, month, year)
        VALUES ($1, $2, $3)
        ON CONFLICT (month, year)
        DO UPDATE SET starting_balance = EXCLUDED.starting_balance
        `,
        [
            snapshotStartingBalance(previousEndingBalance, newBaseBudget),
            today.month,
            today.year,
        ]
    )
}
