/**
 * GET /api/transactions?year= (no month) — the History tab's year view.
 *
 * Added alongside the existing month(+year) and account-only modes, which
 * this file also regression-checks so the new `parsePeriod` branch cannot
 * silently change their behaviour.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { pool } from "@/lib/db"
import { GET } from "@/app/api/transactions/route"
import { toDateString } from "@/lib/dates"
import { createAccount } from "./support/fixtures"
import { truncateAll } from "./support/database"
import type { Transaction } from "@/types/api"

async function get(query: string): Promise<{ status: number; body: Transaction[] }> {
  const res = await GET(new NextRequest(`http://localhost/api/transactions${query}`))
  return { status: res.status, body: await res.json() }
}

async function insert(
  date: string,
  amount: number,
  category: string,
  accountId: string,
  description = "x"
) {
  await pool.query(
    `INSERT INTO transactions (date, amount, description, category, account_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [date, amount, description, category, accountId]
  )
}

beforeEach(async () => {
  await truncateAll(pool)
})

afterAll(async () => {
  await pool.end()
})

describe("GET /api/transactions?year=", () => {
  it("returns every transaction in the year regardless of month", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await insert(toDateString(2025, 1, 1), 10, "grocery", account.id, "january")
    await insert(toDateString(2025, 6, 15), 20, "bills", account.id, "june")
    await insert(toDateString(2025, 12, 31), 30, "income", account.id, "december")

    const { status, body } = await get("?year=2025")

    expect(status).toBe(200)
    expect(body).toHaveLength(3)
    expect(body.map((t) => t.description).sort()).toEqual(["december", "january", "june"])
  })

  it("excludes the adjacent years' boundary transactions", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await insert(toDateString(2024, 12, 31), 999, "misc", account.id, "too old")
    await insert(toDateString(2025, 1, 1), 10, "misc", account.id, "in range start")
    await insert(toDateString(2025, 12, 31), 10, "misc", account.id, "in range end")
    await insert(toDateString(2026, 1, 1), 999, "misc", account.id, "too new")

    const { body } = await get("?year=2025")

    expect(body.map((t) => t.description).sort()).toEqual(["in range end", "in range start"])
  })

  it("combines with category and account filters", async () => {
    const checking = await createAccount(pool, { name: "Checking", type: "Checking" })
    const savings = await createAccount(pool, { name: "Savings", type: "Savings" })
    await insert(toDateString(2025, 3, 1), 10, "grocery", checking.id, "checking grocery")
    await insert(toDateString(2025, 3, 1), 10, "bills", checking.id, "checking bills")
    await insert(toDateString(2025, 3, 1), 10, "grocery", savings.id, "savings grocery")

    expect((await get("?year=2025&category=grocery")).body).toHaveLength(2)
    expect((await get(`?year=2025&account=${checking.id}`)).body).toHaveLength(2)
    expect(
      (await get(`?year=2025&category=grocery&account=${checking.id}`)).body.map((t) => t.description)
    ).toEqual(["checking grocery"])
  })

  it("rejects a non-integer year", async () => {
    expect((await get("?year=abc")).status).toBe(400)
  })
})

describe("GET /api/transactions — existing modes are unaffected", () => {
  it("still supports month+year", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await insert(toDateString(2025, 3, 15), 10, "grocery", account.id, "march")
    await insert(toDateString(2025, 4, 1), 10, "grocery", account.id, "april")

    const { status, body } = await get("?month=3&year=2025")
    expect(status).toBe(200)
    expect(body.map((t) => t.description)).toEqual(["march"])
  })

  it("still supports account-only, with no month or year", async () => {
    const account = await createAccount(pool, { name: "Checking", type: "Checking" })
    await insert(toDateString(2020, 1, 1), 10, "grocery", account.id, "old")
    await insert(toDateString(2030, 1, 1), 10, "grocery", account.id, "future")

    const { body } = await get(`?account=${account.id}`)
    expect(body).toHaveLength(2)
  })

  it("still rejects month without year", async () => {
    expect((await get("?month=3")).status).toBe(400)
  })

  it("still requires month/year or account", async () => {
    expect((await get("")).status).toBe(400)
  })
})
