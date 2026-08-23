/**
 * Account-type vocabulary and the predicates that branch on it.
 *
 * `accounts.type` is free text in the database — the create form's placeholder
 * is literally "e.g., Credit Card, Checking" — and six code paths branch on its
 * contents. Two different matching rules were in use: the API tested
 * `type.includes('credit')` while the monthly script tested `type === 'credit'`
 * exactly, so an account typed "Credit Card" was treated as credit by the API
 * and never reset by the script. Everything now goes through these predicates.
 */

/**
 * The types the UI offers. Advisory, not enforced: the column stays free text,
 * so existing accounts with other values keep working.
 *
 * Turning the free-text input into a picker backed by this list is Phase 5
 * (P1-21) — it changes rendered markup, which Phase 3 does not.
 */
export const ACCOUNT_TYPES = [
  "Checking",
  "Savings",
  "Credit Card",
  "Brokerage",
  "Cash",
] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number]

/**
 * Substring test, never an exact match — "Credit Card" must count as credit.
 *
 * For a credit account, `balance` is money owed (stored negative) and `max` is
 * the credit limit, which income must never move.
 */
export function isCreditAccount(type: string | null | undefined): boolean {
  return (type ?? "").toLowerCase().includes("credit")
}

/**
 * Accounts the monthly job zeroes on rollover. Separate from
 * `isCreditAccount` because the two rules differ everywhere else.
 */
export function isResetOnMonthRollover(type: string | null | undefined): boolean {
  const normalized = (type ?? "").toLowerCase()
  return normalized.includes("credit") || normalized.includes("brokerage")
}
