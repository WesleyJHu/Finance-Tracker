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
import { createBudget } from "./support/fixtures"
import { truncateAll } from "./support/database"

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
