/**
 * GET /api/transactions/monthly_totals, which feeds the dashboard's spending
 * chart.
 *
 * The chart was six hardcoded <div>s on a fixed h-20 -> h-40 ladder: it drew
 * the same rising staircase whatever the data said, which read as six months
 * of steadily increasing spending.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { GET } from "@/app/api/transactions/monthly_totals/route"
import { previousMonth, todayInAppTz, toDateString } from "@/lib/dates"
import { createAccount } from "./support/fixtures"
import { truncateAll } from "./support/database"
import type { MonthlyTotal } from "@/types/api"

const TODAY = todayInAppTz()
const CURRENT = { year: TODAY.year, month: TODAY.month }
const PREVIOUS = previousMonth(CURRENT)

async function totals(query = ""): Promise<{ status: number; body: MonthlyTotal[] }> {
  const res = await GET(new NextRequest(`http://localhost/api/transactions/monthly_totals${query}`))
  return { status: res.status, body: await res.json() }
}

async function spend(accountId: string, period: { year: number; month: number }, amount: number) {
  await pool.query(
    `INSERT INTO transactions (date, amount, description, category, account_id)
     VALUES ($1, $2, 'x', 'grocery', $3)`,
    [toDateString(period.year, period.month, 5), amount, accountId]
  )
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("GET /api/transactions/monthly_totals", () => {
  it("returns six months by default, oldest first, ending with the current month", async () => {
    const { status, body } = await totals()

    expect(status).toBe(200)
    expect(body).toHaveLength(6)
    expect(body[5]).toMatchObject({ year: CURRENT.year, month: CURRENT.month })

    // Strictly increasing in time, with no gaps.
    for (let i = 1; i < body.length; i++) {
      const expected = previousMonth({ year: body[i].year, month: body[i].month })
      expect({ year: body[i - 1].year, month: body[i - 1].month }).toEqual(expected)
    }
  })

  it("returns zeroes for months with no transactions rather than omitting them", async () => {
    // Omitting empty months would leave the chart with uneven bar spacing and
    // silently misalign the months against their neighbours.
    const { body } = await totals()
    expect(body).toHaveLength(6)
    expect(body.every((entry) => entry.income === 0 && entry.expenses === 0)).toBe(true)
  })

  it("separates income from expenses", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await pool.query(
      `INSERT INTO transactions (date, amount, description, category, account_id)
       VALUES ($1, 400, 'rent', 'bills', $2), ($1, 250, 'pay', 'income', $2)`,
      [toDateString(CURRENT.year, CURRENT.month, 5), account.id]
    )

    const { body } = await totals()
    expect(body[5]).toMatchObject({ income: 250, expenses: 400 })
  })

  it("attributes each transaction to its own month", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await spend(account.id, CURRENT, 100)
    await spend(account.id, PREVIOUS, 250)

    const { body } = await totals()
    expect(body[5]).toMatchObject({ ...CURRENT, expenses: 100 })
    expect(body[4]).toMatchObject({ ...PREVIOUS, expenses: 250 })
  })

  it("excludes anything older than the requested window", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })

    // Seven months back, one month outside a six-month window.
    let old = CURRENT
    for (let i = 0; i < 7; i++) old = previousMonth(old)
    await spend(account.id, old, 999)

    const { body } = await totals()
    expect(body).toHaveLength(6)
    expect(body.reduce((sum, entry) => sum + entry.expenses, 0)).toBe(0)
  })

  it("honours ?months=", async () => {
    expect((await totals("?months=1")).body).toHaveLength(1)
    expect((await totals("?months=12")).body).toHaveLength(12)
    expect((await totals("?months=24")).body).toHaveLength(24)
  })

  it("rejects a nonsensical window rather than returning something arbitrary", async () => {
    for (const value of ["0", "-1", "25", "abc", "1.5"]) {
      expect((await totals(`?months=${value}`)).status, value).toBe(400)
    }
  })

  it("crosses a year boundary without producing month 0", async () => {
    const { body } = await totals("?months=24")
    for (const entry of body) {
      expect(entry.month).toBeGreaterThanOrEqual(1)
      expect(entry.month).toBeLessThanOrEqual(12)
    }
  })
})
