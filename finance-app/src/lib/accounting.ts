/**
 * The one place the balance formula lives.
 *
 * This was previously implemented six times — in the transactions POST, PATCH
 * and DELETE handlers, in the recurring-payments script, and twice in
 * page.tsx — and the copies had already drifted apart. Anything that moves
 * money must go through `transactionDeltas`.
 */
import { isCreditAccount, isResetOnMonthRollover } from "@/lib/accountTypes"
import { INCOME, normalizeCategory } from "@/lib/categories"

// Re-exported so callers that only care about money have a single import.
export { isCreditAccount, isResetOnMonthRollover }

/**
 * transactions.category is the Postgres enum public."Category", whose values
 * are all lowercase. recurring_payments.category is varchar in Title Case, so
 * this normalizes before comparing.
 */
export function isIncome(category: string | null | undefined): boolean {
  return normalizeCategory(category) === INCOME
}

export type AccountDeltas = {
  /** Added to accounts.balance. */
  balance: number
  /** Added to accounts.max. */
  max: number
}

/**
 * How one transaction moves the account it belongs to.
 *
 * - Expenses decrease `balance` and leave `max` alone.
 * - Income leaves `balance` alone and increases `max` — except on a credit
 *   account, where `max` is the credit limit and must never move. (The API
 *   rejects Income on a credit account outright; the guard here is
 *   defence in depth.)
 *
 * `amount` is always positive; the sign is applied here.
 */
export function transactionDeltas(
  category: string,
  accountType: string | null | undefined,
  amount: number
): AccountDeltas {
  if (isIncome(category)) {
    return { balance: 0, max: isCreditAccount(accountType) ? 0 : amount }
  }
  return { balance: -amount, max: 0 }
}
