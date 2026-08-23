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

/**
 * A month's ending balance: what it opened with, plus income, less expenses.
 *
 * `starting` already contains that month's base budget (see
 * `snapshotStartingBalance`), which is why the budget is not added again here.
 */
export function monthEndingBalance(
  starting: number,
  income: number,
  expenses: number
): number {
  return starting + income - expenses
}

/**
 * A month's starting balance, as stored in
 * `monthly_balance_snapshot.starting_balance`.
 *
 * DEFINED AS the previous month's ending balance plus this month's base
 * budget. This is the single source of that definition: the snapshot script
 * writes it and src/app/page.tsx reads it, and page.tsx used to add
 * `base_budget` a second time on top (P0-4), so Remaining Budget was one
 * whole month's budget too high. See the header of db/schema.sql.
 */
export function snapshotStartingBalance(
  previousEndingBalance: number,
  baseBudget: number
): number {
  return previousEndingBalance + baseBudget
}
