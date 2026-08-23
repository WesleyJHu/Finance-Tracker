/**
 * The date helpers behind two P0s: the 31st-in-February payment that never
 * fired (P0-7) and the previous-month calculation that resolved in the host
 * timezone instead of ET (process-monthly-balance-snapshot.mjs:20).
 */
import { describe, expect, it } from "vitest"
import {
  daysInMonth,
  isRecurringPaymentDue,
  monthRange,
  previousMonth,
  todayInAppTz,
  toDateString,
} from "@/lib/dates"

describe("daysInMonth", () => {
  it("knows every month of a common year", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ])
  })

  it("handles leap years, including the 400-year rule", () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2100, 2)).toBe(28)
  })

  it("clamps a day-31 recurring payment into a short month (P0-7)", () => {
    // The old check was `day_of_month === currentDay`, so a payment on the
    // 31st never fired in February, April, June, September, or November.
    const clamp = (day: number, year: number, month: number) =>
      Math.min(day, daysInMonth(year, month))

    expect(clamp(31, 2026, 2)).toBe(28)
    expect(clamp(31, 2024, 2)).toBe(29)
    expect(clamp(31, 2026, 4)).toBe(30)
    expect(clamp(31, 2026, 1)).toBe(31)
    expect(clamp(15, 2026, 2)).toBe(15)
  })
})

describe("previousMonth", () => {
  it("steps back within a year", () => {
    expect(previousMonth({ year: 2026, month: 8 })).toEqual({ year: 2026, month: 7 })
  })

  it("rolls the year back at January", () => {
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 })
  })

  it("never produces month 0 or 13 across a full two-year walk", () => {
    let period = { year: 2027, month: 12 }
    for (let i = 0; i < 24; i++) {
      period = previousMonth(period)
      expect(period.month).toBeGreaterThanOrEqual(1)
      expect(period.month).toBeLessThanOrEqual(12)
    }
    expect(period).toEqual({ year: 2025, month: 12 })
  })
})

describe("toDateString", () => {
  it("zero-pads to the YYYY-MM-DD a Postgres date column expects", () => {
    expect(toDateString(2026, 1, 5)).toBe("2026-01-05")
    expect(toDateString(2026, 12, 31)).toBe("2026-12-31")
  })
})

describe("monthRange", () => {
  it("is half-open, so the last day of the month is included", () => {
    expect(monthRange(2026, 8)).toEqual({ start: "2026-08-01", end: "2026-09-01" })
  })

  it("rolls into the next year for December", () => {
    expect(monthRange(2026, 12)).toEqual({ start: "2026-12-01", end: "2027-01-01" })
  })

  it("covers February in a leap year without naming the 29th", () => {
    expect(monthRange(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-03-01" })
  })
})

describe("todayInAppTz", () => {
  it("resolves in ET regardless of the host timezone", () => {
    // 2026-01-01 02:30 UTC is still 2025-12-31 21:30 in New York. A host in
    // UTC would report January; the app must report December.
    expect(todayInAppTz(new Date("2026-01-01T02:30:00Z"))).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    })
  })

  it("is on the ET day, not the UTC day, late in the evening", () => {
    // 20:00 ET on the 31st is already the 1st in UTC. Dating a transaction
    // with toISOString() here put the row in the wrong month.
    expect(todayInAppTz(new Date("2026-08-01T01:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 31,
    })
  })

  it("agrees with UTC during the ET morning", () => {
    expect(todayInAppTz(new Date("2026-08-22T16:00:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 22,
    })
  })

  it("returns a 1-indexed month, not Date's 0-indexed one", () => {
    expect(todayInAppTz(new Date("2026-01-15T17:00:00Z")).month).toBe(1)
  })
})

describe("isRecurringPaymentDue (P0-7)", () => {
  it("fires on the matching day of a long month", () => {
    expect(isRecurringPaymentDue(15, { year: 2026, month: 1, day: 15 })).toBe(true)
    expect(isRecurringPaymentDue(15, { year: 2026, month: 1, day: 14 })).toBe(false)
    expect(isRecurringPaymentDue(31, { year: 2026, month: 1, day: 31 })).toBe(true)
  })

  it("fires on the 28th of February for a payment set to the 31st", () => {
    // The old test was `day_of_month === currentDay`, so this payment never
    // fired at all in February, April, June, September, or November.
    expect(isRecurringPaymentDue(31, { year: 2026, month: 2, day: 28 })).toBe(true)
    expect(isRecurringPaymentDue(30, { year: 2026, month: 2, day: 28 })).toBe(true)
    expect(isRecurringPaymentDue(29, { year: 2026, month: 2, day: 28 })).toBe(true)
  })

  it("fires on the 29th, not the 28th, in a leap February", () => {
    expect(isRecurringPaymentDue(31, { year: 2024, month: 2, day: 28 })).toBe(false)
    expect(isRecurringPaymentDue(31, { year: 2024, month: 2, day: 29 })).toBe(true)
  })

  it("fires on the 30th of a 30-day month for a payment set to the 31st", () => {
    for (const month of [4, 6, 9, 11]) {
      expect(isRecurringPaymentDue(31, { year: 2026, month, day: 30 }), `month ${month}`).toBe(
        true
      )
      expect(isRecurringPaymentDue(31, { year: 2026, month, day: 29 }), `month ${month}`).toBe(
        false
      )
    }
  })

  it("fires exactly once per month across a whole year", () => {
    for (const dayOfMonth of [1, 15, 28, 29, 30, 31]) {
      for (let month = 1; month <= 12; month++) {
        const hits = []
        for (let day = 1; day <= daysInMonth(2026, month); day++) {
          if (isRecurringPaymentDue(dayOfMonth, { year: 2026, month, day })) hits.push(day)
        }
        expect(hits, `day ${dayOfMonth} in month ${month}`).toHaveLength(1)
      }
    }
  })
})
