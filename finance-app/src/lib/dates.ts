/**
 * One timezone regime for the whole app.
 *
 * There were previously three: the API built month boundaries in Node process
 * local time, the scripts derived "today" correctly in ET but then computed
 * the previous month with `Date#getMonth()` in local time, and one script
 * dated its writes with `toISOString()` in UTC after checking due-ness in ET.
 */

export const APP_TZ = "America/New_York"

export type CalendarDate = {
  /** Full year, e.g. 2026. */
  year: number
  /** 1-12, not the 0-11 that Date uses. */
  month: number
  /** 1-31. */
  day: number
}

/**
 * Today's calendar date in the app's timezone, independent of the host's TZ.
 *
 * The Dockerfile pins TZ=America/New_York, but relying on that means the app
 * silently changes behaviour if the container timezone is ever edited.
 */
export function todayInAppTz(now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)

  return { year: part("year"), month: part("month"), day: part("day") }
}

/** The month before the given one, rolling the year back at January. */
export function previousMonth(period: { year: number; month: number }) {
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 }
}

/**
 * Number of days in a 1-indexed month. Uses UTC so the host timezone cannot
 * shift the answer.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `YYYY-MM-DD`, suitable for a Postgres `date` column. */
export function toDateString(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Half-open `[start, end)` bounds for a month, as `YYYY-MM-DD` strings. */
export function monthRange(year: number, month: number) {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return {
    start: toDateString(year, month, 1),
    end: toDateString(next.year, next.month, 1),
  }
}

/** Half-open `[start, end)` bounds for a calendar year, as `YYYY-MM-DD` strings. */
export function yearRange(year: number) {
  return {
    start: toDateString(year, 1, 1),
    end: toDateString(year + 1, 1, 1),
  }
}

/**
 * Whether a recurring payment set to run on `dayOfMonth` is due on `today`.
 *
 * The day is clamped to the length of the month, so a payment on the 31st
 * still fires on the 28th of February rather than silently never firing —
 * the old `day_of_month === currentDay` test skipped five months a year for
 * a payment on the 31st, and February for anything after the 28th (P0-7).
 */
export function isRecurringPaymentDue(
  dayOfMonth: number,
  today: { year: number; month: number; day: number }
): boolean {
  const dueDay = Math.min(dayOfMonth, daysInMonth(today.year, today.month))
  return dueDay === today.day
}
