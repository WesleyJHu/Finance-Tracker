/**
 * Shared route-handler plumbing.
 *
 * Replaces ~15 near-identical catch blocks (each logging the same error three
 * or four times), three ad-hoc month/year parsers, six hand-written row
 * serializers, and ~15 `if (!x) return 400` checks that used falsy tests and
 * so rejected legitimate zero values.
 */
import { NextResponse } from "next/server"
import type { QueryResultRow } from "pg"
import { HttpError } from "@/lib/db"
import type { Account, BalanceSnapshot, MonthlyBudget, RecurringPayment, Transaction } from "@/types/api"

/**
 * Turns a thrown error into a response.
 *
 * `HttpError` carries an intended status and a message safe to show the user.
 * Anything else is logged once and reported generically — the transactions
 * POST used to return `error.message`, leaking driver internals such as
 * constraint names and the failing enum value to the browser.
 */
export function handleRouteError(error: unknown, context: string) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error(`${context} failed:`, error)
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
}

/** Rejects with a 400 unless the value is present. Zero and empty string pass. */
export function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new HttpError(400, `${name} is required`)
  }
  return value
}

/** Coerces to a finite number or throws a 400. Accepts 0. */
export function requireNumber(value: unknown, name: string): number {
  const parsed = Number(value)
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) {
    throw new HttpError(400, `Invalid ${name}`)
  }
  return parsed
}

export type MonthYear = { month: number; year: number }

/**
 * Parses and validates `?month=&year=`.
 *
 * Returns null when both are absent, so callers can distinguish "not supplied"
 * from "supplied but wrong" — three routes previously conflated the two.
 */
export function parseMonthYear(params: URLSearchParams): MonthYear | null {
  const monthParam = params.get("month")
  const yearParam = params.get("year")

  if (!monthParam && !yearParam) return null

  const month = Number(monthParam)
  const year = Number(yearParam)

  if (
    !monthParam || !yearParam ||
    !Number.isInteger(month) || !Number.isInteger(year) ||
    month < 1 || month > 12
  ) {
    throw new HttpError(400, "Invalid month or year")
  }

  return { month, year }
}

/**
 * Reads the record id for a DELETE.
 *
 * Accepts the query string, which is now the documented form, and still falls
 * back to a JSON body so older callers keep working: `accounts` and
 * `transactions` read it from the body while `recurring_payments` read it from
 * the query string, and unifying without a fallback would have been a silent
 * breaking change.
 */
export async function readDeleteId(req: Request): Promise<string> {
  const fromQuery = new URL(req.url).searchParams.get("id")
  if (fromQuery) return fromQuery

  try {
    const body = await req.json()
    if (body?.id !== undefined && body.id !== null && body.id !== "") {
      return String(body.id)
    }
  } catch {
    // No body, or not JSON. Fall through to the error below.
  }

  throw new HttpError(400, "id is required")
}

/**
 * Builds a parameterised partial UPDATE.
 *
 * Column names come from the caller's whitelist and are never taken from
 * request data; every value is bound. Returns null when nothing was supplied.
 */
export function buildUpdate(
  fields: Record<string, unknown>,
  allowed: readonly string[],
  firstIndex = 1
): { clause: string; values: unknown[] } | null {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const column of allowed) {
    const value = fields[column]
    if (value === undefined) continue
    assignments.push(`${column} = $${firstIndex + values.length}`)
    values.push(value)
  }

  return assignments.length === 0 ? null : { clause: assignments.join(", "), values }
}

// ---------------------------------------------------------------------------
// Row serializers
//
// `pg` returns numeric columns as strings to avoid precision loss. Each route
// used to coerce them inline, inconsistently.
// ---------------------------------------------------------------------------

const num = (value: unknown): number => Number(value)

export function serializeAccount(row: QueryResultRow): Account {
  return { ...row, balance: num(row.balance), max: num(row.max) } as Account
}

export function serializeTransaction(row: QueryResultRow): Transaction {
  return { ...row, amount: num(row.amount) } as Transaction
}

export function serializeMonthlyBudget(row: QueryResultRow): MonthlyBudget {
  return { ...row, month: num(row.month), base_budget: num(row.base_budget) } as MonthlyBudget
}

export function serializeBalanceSnapshot(row: QueryResultRow): BalanceSnapshot {
  return {
    ...row,
    starting_balance: num(row.starting_balance),
    ending_balance: row.ending_balance === null ? null : num(row.ending_balance),
    month: num(row.month),
    year: num(row.year),
  } as BalanceSnapshot
}

export function serializeRecurringPayment(row: QueryResultRow): RecurringPayment {
  return { ...row, amount: num(row.amount), day_of_month: num(row.day_of_month) } as RecurringPayment
}
