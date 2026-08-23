/**
 * transactionDeltas is the function CODE_REVIEW.md found miscopied in six
 * places, with the copies already drifted apart. These tests pin every
 * category x account-type combination so a seventh copy cannot reappear
 * quietly.
 */
import { describe, expect, it } from "vitest"
import { transactionDeltas, isIncome } from "@/lib/accounting"
import { isCreditAccount, isResetOnMonthRollover, ACCOUNT_TYPES } from "@/lib/accountTypes"
import { CATEGORY_VALUES } from "@/types/api"

describe("isIncome", () => {
  it("matches the enum's lowercase value", () => {
    expect(isIncome("income")).toBe(true)
  })

  it("matches recurring_payments' Title Case, which is a different column type", () => {
    expect(isIncome("Income")).toBe(true)
    expect(isIncome("  INCOME  ")).toBe(true)
  })

  it("is false for every other category", () => {
    for (const category of CATEGORY_VALUES.filter((c) => c !== "income")) {
      expect(isIncome(category), category).toBe(false)
    }
  })

  it("is false for null, undefined, and unknown text", () => {
    expect(isIncome(null)).toBe(false)
    expect(isIncome(undefined)).toBe(false)
    expect(isIncome("incoming")).toBe(false)
    expect(isIncome("")).toBe(false)
  })
})

describe("isCreditAccount", () => {
  it("matches by substring, so 'Credit Card' counts", () => {
    // The API tested includes('credit') while the monthly script tested
    // type === 'credit' exactly, so "Credit Card" was credit to one and not
    // the other. This is the regression test for that split.
    expect(isCreditAccount("Credit Card")).toBe(true)
    expect(isCreditAccount("credit")).toBe(true)
    expect(isCreditAccount("Amex Credit")).toBe(true)
  })

  it("is false for the non-credit types the UI offers", () => {
    expect(isCreditAccount("Checking")).toBe(false)
    expect(isCreditAccount("Savings")).toBe(false)
    expect(isCreditAccount("Brokerage")).toBe(false)
    expect(isCreditAccount("Cash")).toBe(false)
  })

  it("treats a missing type as not credit", () => {
    expect(isCreditAccount(null)).toBe(false)
    expect(isCreditAccount(undefined)).toBe(false)
    expect(isCreditAccount("")).toBe(false)
  })
})

describe("isResetOnMonthRollover", () => {
  it("covers credit and brokerage, by substring", () => {
    expect(isResetOnMonthRollover("Credit Card")).toBe(true)
    expect(isResetOnMonthRollover("Brokerage")).toBe(true)
    expect(isResetOnMonthRollover("brokerage account")).toBe(true)
  })

  it("leaves bank accounts alone", () => {
    expect(isResetOnMonthRollover("Checking")).toBe(false)
    expect(isResetOnMonthRollover("Savings")).toBe(false)
    expect(isResetOnMonthRollover("Cash")).toBe(false)
    expect(isResetOnMonthRollover(null)).toBe(false)
  })
})

describe("transactionDeltas: every category x account type", () => {
  const AMOUNT = 125.5

  it("expenses debit balance and never touch max, on every account type", () => {
    const expenses = CATEGORY_VALUES.filter((c) => c !== "income")
    for (const type of ACCOUNT_TYPES) {
      for (const category of expenses) {
        expect(transactionDeltas(category, type, AMOUNT), `${category}/${type}`).toEqual({
          balance: -AMOUNT,
          max: 0,
        })
      }
    }
  })

  it("income credits max and leaves balance alone, on a bank account", () => {
    for (const type of ACCOUNT_TYPES.filter((t) => !isCreditAccount(t))) {
      expect(transactionDeltas("income", type, AMOUNT), type).toEqual({
        balance: 0,
        max: AMOUNT,
      })
    }
  })

  it("income moves nothing on a credit account, where max is the credit limit", () => {
    // The API rejects this outright; the delta function is defence in depth,
    // and the recurring-payment script relies on it.
    expect(transactionDeltas("income", "Credit Card", AMOUNT)).toEqual({
      balance: 0,
      max: 0,
    })
  })

  it("accepts recurring_payments' Title Case category", () => {
    expect(transactionDeltas("Income", "Checking", AMOUNT)).toEqual({
      balance: 0,
      max: AMOUNT,
    })
    expect(transactionDeltas("Grocery", "Checking", AMOUNT)).toEqual({
      balance: -AMOUNT,
      max: 0,
    })
  })

  it("treats an unknown account type as non-credit", () => {
    expect(transactionDeltas("income", null, AMOUNT)).toEqual({ balance: 0, max: AMOUNT })
    expect(transactionDeltas("income", "Wallet", AMOUNT)).toEqual({ balance: 0, max: AMOUNT })
  })

  it("keeps a zero amount a no-op rather than producing -0", () => {
    expect(transactionDeltas("grocery", "Checking", 0).balance).toBe(-0)
    expect(transactionDeltas("grocery", "Checking", 0).balance === 0).toBe(true)
  })
})
