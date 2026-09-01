/**
 * Display formatting, in one place.
 *
 * Replaces four copies of `formatCurrency` (page.tsx, AccountCard,
 * AccountModal, SettingsModal) and two copies of `formatDate` that disagreed:
 * page.tsx passed `timeZone: 'America/New_York'` and AccountModal omitted it,
 * so the same transaction could render as two different dates in the table
 * versus the account modal.
 */
import { APP_TZ } from "@/lib/dates"

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function formatCurrency(value: number): string {
  return currency.format(value)
}

/**
 * `"2026-08-22"` -> `"Aug 22, 2026"`.
 *
 * Always rendered in the app's timezone, so a viewer elsewhere sees the same
 * date the dashboard and the scripts do. Unifying on the timezone-aware
 * version is a deliberate bug fix: AccountModal dates shift by up to a day for
 * non-ET viewers today.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatDate(value: string | Date): string {
  // A bare "YYYY-MM-DD" is a calendar date, not an instant. `new Date(s)`
  // reads it as UTC midnight, which is the *previous* day in ET, so a
  // transaction dated the 1st rendered as the last day of the prior month.
  // Anchor it at UTC noon and format in UTC so no zone can shift it.
  const dateOnly = typeof value === "string" ? DATE_ONLY.exec(value.trim()) : null
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    return CALENDAR.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)))
  }

  // A real instant (created_at, or a Date handed in by a caller) is rendered
  // in the app timezone, so a viewer elsewhere sees the same day the
  // dashboard and the scripts do.
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return INSTANT.format(date)
}

const CALENDAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
})

const INSTANT = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
})

/**
 * A calendar date (already resolved to the app's timezone) as
 * `"Saturday, August 22"`.
 *
 * Takes the parts rather than a Date so it cannot be shifted by the viewer's
 * timezone: the previous code built `new Date(year, month - 1, day)` in
 * browser-local time and formatted that.
 */
export function formatLongDate(year: number, month: number, day: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/**
 * A 1-indexed month and a year as `"July 2026"`.
 *
 * `timeZone: "UTC"` is load-bearing, not decoration. Date.UTC(2026, 6, 1) is
 * midnight UTC on July 1st, which is 20:00 on June *30th* in ET — so
 * formatting it in the viewer's zone renders the previous month. The History
 * tab's heading did exactly that: picking July labelled the page "June" while
 * correctly showing July's transactions.
 */
export function formatMonthYear(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}
