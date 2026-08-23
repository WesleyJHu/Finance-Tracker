/**
 * The starting_balance definition (P0-4).
 *
 * The snapshot script writes it and src/app/page.tsx reads it. page.tsx used
 * to add base_budget a second time on top, so Remaining Budget was one whole
 * month's budget too high. These tests pin the definition both sides depend on.
 */
import { describe, expect, it } from "vitest"
import { monthEndingBalance, snapshotStartingBalance } from "@/lib/accounting"

describe("monthEndingBalance", () => {
  it("is starting + income - expenses", () => {
    expect(monthEndingBalance(1000, 250, 400)).toBe(850)
  })

  it("can go negative when a month overspends", () => {
    expect(monthEndingBalance(100, 0, 400)).toBe(-300)
  })

  it("is a no-op for a month with no activity", () => {
    expect(monthEndingBalance(1234.56, 0, 0)).toBe(1234.56)
  })

  it("treats a first-ever month, with no previous snapshot, as opening at 0", () => {
    // The script substitutes 0 when the previous period has no row. This is
    // the case that used to throw a TypeError on rows[0] (P0-6).
    expect(monthEndingBalance(0, 500, 120)).toBe(380)
  })
})

describe("snapshotStartingBalance", () => {
  it("is the previous month's ending balance plus this month's base budget", () => {
    expect(snapshotStartingBalance(850, 2000)).toBe(2850)
  })

  it("counts the base budget exactly once (P0-4)", () => {
    // The dashboard's budgetCapacity must equal this value, not this value
    // plus base_budget again.
    const previousEnding = 850
    const baseBudget = 2000
    const starting = snapshotStartingBalance(previousEnding, baseBudget)

    expect(starting).toBe(previousEnding + baseBudget)
    expect(starting).not.toBe(previousEnding + baseBudget * 2)
  })

  it("carries a negative carryover forward rather than clamping it", () => {
    expect(snapshotStartingBalance(-300, 2000)).toBe(1700)
  })

  it("accepts a legitimate zero budget", () => {
    // `if (!month || !base_budget)` used to reject a $0 budget outright (P0-13).
    expect(snapshotStartingBalance(500, 0)).toBe(500)
  })
})

describe("a full three-month chain", () => {
  it("carries balances forward without re-adding the budget", () => {
    const budget = 2000

    // Month 1: opens at budget alone (no prior snapshot), spends 1500.
    const m1Start = snapshotStartingBalance(0, budget)
    expect(m1Start).toBe(2000)
    const m1End = monthEndingBalance(m1Start, 0, 1500)
    expect(m1End).toBe(500)

    // Month 2: carries the 500 over, earns 300, spends 2100.
    const m2Start = snapshotStartingBalance(m1End, budget)
    expect(m2Start).toBe(2500)
    const m2End = monthEndingBalance(m2Start, 300, 2100)
    expect(m2End).toBe(700)

    // Month 3: carries the 700 over.
    expect(snapshotStartingBalance(m2End, budget)).toBe(2700)
  })
})
