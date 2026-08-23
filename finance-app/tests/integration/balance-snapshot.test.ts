/**
 * GET /api/balance_snapshot — month mode (existing) and year mode (new, for
 * the History tab). There is no per-year row in monthly_balance_snapshot, so
 * year mode derives {starting_balance, ending_balance} from that year's
 * January and December rows.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { GET } from "@/app/api/balance_snapshot/route"
import { createSnapshot } from "./support/fixtures"
import { truncateAll } from "./support/database"
import type { BalanceSnapshot, YearBalanceSummary } from "@/types/api"

async function get(query: string) {
  const res = await GET(new NextRequest(`http://localhost/api/balance_snapshot${query}`))
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("GET /api/balance_snapshot?month=&year= (existing behavior)", () => {
  it("returns the one matching row as an array", async () => {
    await createSnapshot(pool, { month: 3, year: 2025, startingBalance: 1000, endingBalance: 1200 })

    const { status, body } = (await get("?month=3&year=2025")) as {
      status: number
      body: BalanceSnapshot[]
    }
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ starting_balance: 1000, ending_balance: 1200 })
  })

  it("returns an empty array when the month has no snapshot yet", async () => {
    const { body } = await get("?month=3&year=2025")
    expect(body).toEqual([])
  })

  it("still requires both month and year", async () => {
    expect((await get("?month=3")).status).toBe(400)
  })
})

describe("GET /api/balance_snapshot?year= (new: year mode)", () => {
  it("derives starting from January and ending from December", async () => {
    await createSnapshot(pool, { month: 1, year: 2025, startingBalance: 500, endingBalance: 700 })
    for (let month = 2; month < 12; month++) {
      await createSnapshot(pool, { month, year: 2025, startingBalance: 0, endingBalance: 0 })
    }
    await createSnapshot(pool, { month: 12, year: 2025, startingBalance: 900, endingBalance: 1100 })

    const { status, body } = (await get("?year=2025")) as { status: number; body: YearBalanceSummary }
    expect(status).toBe(200)
    expect(body).toEqual({ year: 2025, starting_balance: 500, ending_balance: 1100 })
  })

  it("returns ending_balance: null when December hasn't closed yet", async () => {
    await createSnapshot(pool, { month: 1, year: 2025, startingBalance: 500, endingBalance: 700 })
    await createSnapshot(pool, { month: 12, year: 2025, startingBalance: 900, endingBalance: null })

    const { body } = (await get("?year=2025")) as { body: YearBalanceSummary }
    expect(body).toEqual({ year: 2025, starting_balance: 500, ending_balance: null })
  })

  it("returns both fields null when neither row exists", async () => {
    const { body } = (await get("?year=2025")) as { body: YearBalanceSummary }
    expect(body).toEqual({ year: 2025, starting_balance: null, ending_balance: null })
  })

  it("returns starting_balance: null when only December's row exists", async () => {
    await createSnapshot(pool, { month: 12, year: 2025, startingBalance: 900, endingBalance: 1100 })

    const { body } = (await get("?year=2025")) as { body: YearBalanceSummary }
    expect(body).toEqual({ year: 2025, starting_balance: null, ending_balance: 1100 })
  })

  it("rejects a non-integer year", async () => {
    expect((await get("?year=abc")).status).toBe(400)
  })

  it("does not mix up snapshot rows from a neighbouring year", async () => {
    await createSnapshot(pool, { month: 1, year: 2024, startingBalance: 1, endingBalance: 2 })
    await createSnapshot(pool, { month: 12, year: 2024, startingBalance: 3, endingBalance: 4 })
    await createSnapshot(pool, { month: 1, year: 2025, startingBalance: 500, endingBalance: 700 })
    await createSnapshot(pool, { month: 12, year: 2025, startingBalance: 900, endingBalance: 1100 })

    const { body } = (await get("?year=2025")) as { body: YearBalanceSummary }
    expect(body).toEqual({ year: 2025, starting_balance: 500, ending_balance: 1100 })
  })
})
