/**
 * Everything about transaction categories, in one place.
 *
 * Replaces three byte-identical `categories` arrays (AddTransactionModal,
 * EditTransactionModal, SettingsModal), 12+ bare `'income'` string literals,
 * and the ad-hoc `formatCategoryName` helper.
 *
 * Two casings coexist in the database and both are load-bearing:
 *  - `transactions.category` is the enum public."Category" — always lowercase.
 *  - `recurring_payments.category` is varchar(50) and holds Title Case.
 * So anything crossing from a recurring payment into a transaction must be
 * normalized first, or the insert throws.
 */
import { CATEGORY_VALUES, type Category } from "@/types/api"

export { CATEGORY_VALUES }
export type { Category }

/** The one category with special balance semantics. */
export const INCOME: Category = "income"

/** Canonical lowercase values, in the order the UI lists them. */
export const CATEGORIES: readonly Category[] = CATEGORY_VALUES

/** Title Case labels for display, derived so the two can never drift. */
export const CATEGORY_LABELS: readonly string[] = CATEGORY_VALUES.map(displayCategory)

/** Lowercases to the enum's casing. Returns null if it is not a known value. */
export function normalizeCategory(value: string | null | undefined): Category | null {
  const normalized = (value ?? "").trim().toLowerCase()
  return (CATEGORY_VALUES as readonly string[]).includes(normalized)
    ? (normalized as Category)
    : null
}

export function isCategory(value: string | null | undefined): value is Category {
  return normalizeCategory(value) !== null
}

/** `"income"` -> `"Income"`. Was `formatCategoryName` in EditTransactionModal. */
export function displayCategory(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/**
 * Path to a category's icon in public/.
 *
 * Falls back to misc.svg rather than rendering a broken image. The enum makes
 * an unknown category impossible for transactions, but recurring payments are
 * free text and the dashboard has an 'Uncategorized' display fallback.
 */
export function categoryIcon(value: string | null | undefined): string {
  return `/${normalizeCategory(value) ?? "misc"}.svg`
}
