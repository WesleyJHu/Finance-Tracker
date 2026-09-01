/**
 * Display formatting. formatDate existed in two copies that disagreed —
 * page.tsx pinned the app timezone and AccountModal did not — so the same
 * transaction rendered as two different dates in two places.
 */
import { describe, expect, it } from "vitest"
import { formatCurrency, formatDate, formatLongDate, formatMonthYear } from "@/lib/format"

describe("formatCurrency", () => {
  it("renders USD with two decimals", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50")
    expect(formatCurrency(0)).toBe("$0.00")
  })

  it("renders a negative balance, which credit accounts store", () => {
    expect(formatCurrency(-250)).toBe("-$250.00")
  })

  it("rounds to cents", () => {
    expect(formatCurrency(0.005)).toBe("$0.01")
  })
})

describe("formatDate", () => {
  it("renders a bare date column as the calendar date it is", () => {
    // "2026-08-22" is a Postgres `date`: no time, no zone. Reading it as an
    // instant makes it UTC midnight, which is Aug 21 at 20:00 in ET, so the
    // row displayed a day early. It must not shift.
    expect(formatDate("2026-08-22")).toBe("Aug 22, 2026")
  })

  it("does not shift a date across a month or year boundary", () => {
    // The worst case: the 1st of January rendering as December 31st of the
    // previous year, putting the row in the wrong month AND the wrong year.
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026")
    expect(formatDate("2025-12-31")).toBe("Dec 31, 2025")
    expect(formatDate("2026-03-01")).toBe("Mar 1, 2026")
  })

  it("survives a DST boundary in both directions", () => {
    // ET shifts on the second Sunday of March and first Sunday of November.
    expect(formatDate("2026-03-08")).toBe("Mar 8, 2026")
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026")
  })

  it("still renders a real instant in the app timezone", () => {
    // created_at is a timestamp, not a date. 01:00 UTC is the previous
    // evening in ET, and that IS the correct local day for an instant.
    expect(formatDate("2026-08-22T01:00:00Z")).toBe("Aug 21, 2026")
    expect(formatDate(new Date("2026-08-22T16:00:00Z"))).toBe("Aug 22, 2026")
  })

  it("returns the input unchanged rather than 'Invalid Date'", () => {
    expect(formatDate("not a date")).toBe("not a date")
  })
})

describe("formatLongDate", () => {
  it("takes calendar parts so the viewer's timezone cannot shift it", () => {
    expect(formatLongDate(2026, 8, 22)).toBe("Saturday, August 22")
    expect(formatLongDate(2026, 1, 1)).toBe("Thursday, January 1")
  })

  it("takes a 1-indexed month", () => {
    expect(formatLongDate(2026, 12, 25)).toContain("December")
  })
})

describe("formatMonthYear", () => {
  it("does not slip to the previous month in a behind-UTC timezone", () => {
    // The History heading built this inline without timeZone: "UTC". Date.UTC
    // for the 1st is 20:00 on the LAST day of the previous month in ET, so
    // picking July labelled the page "June 2026" over July's transactions.
    expect(formatMonthYear(2026, 7)).toBe("July 2026")
  })

  it("takes a 1-indexed month across the whole year", () => {
    expect(formatMonthYear(2026, 1)).toBe("January 2026")
    expect(formatMonthYear(2026, 12)).toBe("December 2026")
  })

  it("does not roll the year over at either edge", () => {
    // January is where an off-by-one would also corrupt the year.
    expect(formatMonthYear(2026, 1)).not.toContain("2025")
    expect(formatMonthYear(2026, 12)).not.toContain("2027")
  })
})
