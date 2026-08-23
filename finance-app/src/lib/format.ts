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
export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

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
