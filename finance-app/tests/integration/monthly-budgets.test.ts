/**
 * The settings grid renders all 12 months whether or not the database has a
 * row for each, so saving a month that had never been touched used to 404.
 * Nothing checked the response, so the value silently reverted on the next
 * load. PATCH is an upsert now.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { GET, PATCH } from "@/app/api/monthly_budgets/route"
import { createBudget, createSnapshot } from "./support/fixtures"
import { truncateAll } from "./support/database"
import { previousMonth, todayInAppTz } from "@/lib/dates"

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/monthly_budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

async function budgetFor(month: number) {
  const res = await GET(new NextRequest(`http://localhost/api/monthly_budgets?month=${month}`))
  const rows = await res.json()
  return rows[0]
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("PATCH /api/monthly_budgets", () => {
  it("creates a row for a month that has never been saved", async () => {
    const res = await patch({ month: 3, base_budget: 2500 })

    expect(res.status).toBe(200)
    expect(await budgetFor(3)).toMatchObject({ month: 3, base_budget: 2500 })
  })

  it("updates a month that already has a row", async () => {
    await createBudget(pool, 3, 2000)

    expect((await patch({ month: 3, base_budget: 2500 })).status).toBe(200)
    expect(await budgetFor(3)).toMatchObject({ base_budget: 2500 })

    // And does not create a second row for the same month.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM monthly_budgets`)
    expect(rows[0].n).toBe(1)
  })

  it("accepts a budget of zero", async () => {
    // `if (!month || !base_budget)` rejected a legitimate $0 budget outright,
    // permanently and silently (P0-13).
    expect((await patch({ month: 4, base_budget: 0 })).status).toBe(200)
    expect(await budgetFor(4)).toMatchObject({ base_budget: 0 })
  })

  it("rejects a month outside 1-12", async () => {
    for (const month of [0, 13, -1, 1.5]) {
      expect((await patch({ month, base_budget: 100 })).status, String(month)).toBe(400)
    }
  })

  it("rejects a missing budget rather than defaulting it", async () => {
    expect((await patch({ month: 5 })).status).toBe(400)
    expect((await patch({ base_budget: 100 })).status).toBe(400)
  })
})

/**
 * `monthly_balance_snapshot.starting_balance` is defined as the previous
 * month's ending balance plus this month's base budget, and the dashboard's
 * Remaining Budget reads it directly. Only the snapshot job wrote it, at
 * midnight on the 1st, so entering a base budget any time after that left
 * Remaining Budget showing the old figure — the budget looked ignored.
 */
describe("PATCH /api/monthly_budgets keeps this month's snapshot in step", () => {
  const today = todayInAppTz()
  const previous = previousMonth({ year: today.year, month: today.month })

  async function startingBalanceFor(month: number, year: number) {
    const { rows } = await pool.query(
      `SELECT starting_balance FROM monthly_balance_snapshot WHERE month = $1 AND year = $2`,
      [month, year]
    )
    return rows.length === 0 ? null : Number(rows[0].starting_balance)
  }

  it("shifts an existing snapshot by the change in budget", async () => {
    await createBudget(pool, today.month, 100)
    // 400 carried over from last month plus the 100 budget.
    await createSnapshot(pool, {
      month: today.month,
      year: today.year,
      startingBalance: 500,
    })

    await patch({ month: today.month, base_budget: 300 })

    expect(await startingBalanceFor(today.month, today.year)).toBe(700)
  })

  it("shifts downwards too", async () => {
    await createBudget(pool, today.month, 300)
    await createSnapshot(pool, {
      month: today.month,
      year: today.year,
      startingBalance: 700,
    })

    await patch({ month: today.month, base_budget: 100 })

    expect(await startingBalanceFor(today.month, today.year)).toBe(500)
  })

  it("opens the month when the job has not run yet, carrying the previous ending balance", async () => {
    await createSnapshot(pool, {
      month: previous.month,
      year: previous.year,
      startingBalance: 0,
      endingBalance: 400,
    })

    await patch({ month: today.month, base_budget: 100 })

    expect(await startingBalanceFor(today.month, today.year)).toBe(500)
  })

  it("treats a previous month that was never closed out as zero carryover", async () => {
    await patch({ month: today.month, base_budget: 100 })

    expect(await startingBalanceFor(today.month, today.year)).toBe(100)
  })

  it("leaves other months' snapshots alone", async () => {
    await createSnapshot(pool, {
      month: today.month,
      year: today.year,
      startingBalance: 500,
    })

    // A different month, edited from the settings grid.
    const otherMonth = today.month === 12 ? 11 : today.month + 1
    await patch({ month: otherMonth, base_budget: 9999 })

    expect(await startingBalanceFor(today.month, today.year)).toBe(500)
  })
})
