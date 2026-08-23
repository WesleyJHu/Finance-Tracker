/**
 * Category normalization. Two casings coexist in the database and both are
 * load-bearing: transactions.category is the lowercase enum public."Category",
 * recurring_payments.category is varchar(50) in Title Case. Anything crossing
 * from one to the other must be normalized or the insert throws.
 */
import { describe, expect, it } from "vitest"
import {
  CATEGORIES,
  INCOME,
  categoryIcon,
  displayCategory,
  isCategory,
  normalizeCategory,
} from "@/lib/categories"

describe("CATEGORIES", () => {
  it("is the enum's eight lowercase values", () => {
    expect(CATEGORIES.length).toBe(8)
    for (const category of CATEGORIES) {
      expect(category, category).toBe(category.toLowerCase())
    }
  })

  it("includes income", () => {
    expect(CATEGORIES).toContain(INCOME)
  })
})

describe("normalizeCategory", () => {
  it("lowercases recurring_payments' Title Case into the enum's casing", () => {
    for (const category of CATEGORIES) {
      const titleCase = category.charAt(0).toUpperCase() + category.slice(1)
      expect(normalizeCategory(titleCase), titleCase).toBe(category)
    }
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeCategory("  Income  ")).toBe("income")
  })

  it("returns null rather than an invalid enum value", () => {
    // Passing an unknown value straight through is what produced
    // `invalid input value for enum "Category"` as a raw 500 in the browser.
    expect(normalizeCategory("Crypto")).toBeNull()
    expect(normalizeCategory("")).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
    expect(normalizeCategory(undefined)).toBeNull()
  })
})

describe("isCategory", () => {
  it("narrows known values and rejects the rest", () => {
    expect(isCategory("income")).toBe(true)
    expect(isCategory("Income")).toBe(true)
    expect(isCategory("nonsense")).toBe(false)
  })
})

describe("displayCategory", () => {
  it("Title Cases for display", () => {
    expect(displayCategory("income")).toBe("Income")
    expect(displayCategory("GROCERIES")).toBe("Groceries")
  })

  it("returns an empty string for nothing, not 'Undefined'", () => {
    expect(displayCategory(null)).toBe("")
    expect(displayCategory("   ")).toBe("")
  })
})

describe("categoryIcon", () => {
  it("maps each category to its own svg", () => {
    for (const category of CATEGORIES) {
      expect(categoryIcon(category)).toBe(`/${category}.svg`)
    }
  })

  it("falls back to misc.svg instead of a broken image", () => {
    expect(categoryIcon("Crypto")).toBe("/misc.svg")
    expect(categoryIcon(null)).toBe("/misc.svg")
  })
})
