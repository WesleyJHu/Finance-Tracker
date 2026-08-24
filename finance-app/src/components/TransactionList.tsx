"use client";

import { useState } from "react";
import CategoryIcon from "./CategoryIcon";
import { formatCurrency, formatDate } from "@/lib/format";
import { displayCategory } from "@/lib/categories";
import { isIncome } from "@/lib/accounting";
import type { Transaction } from "@/types/api";

export interface TransactionListProps {
  /** Already filtered AND already ordered by the caller. */
  transactions: Transaction[];
  /** `accounts.name` is nullable, hence the union; rows fall back to "Unknown". */
  accountNameById: Record<string, string | null>;
  emptyMessage: string;
  /** Both must be supplied for the actions row to render; History omits them. */
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
  className?: string;
}

/**
 * The mobile rendering of a transaction list.
 *
 * The desktop table has six columns and only scrolled sideways on a phone,
 * which put the amount and date off-screen. This renders the same rows as
 * stacked cards instead: description and amount on one line, then
 * "Category · Account · Date" beneath.
 *
 * Shown below `md`, where the table is hidden — the two are never both in the
 * accessibility tree.
 */
export default function TransactionList({
  transactions,
  accountNameById,
  emptyMessage,
  onEdit,
  onDelete,
  className = "",
}: TransactionListProps) {
  // Deleting on desktop is immediate, but a mis-tap is far likelier on a
  // phone, so the mobile path confirms first. Same inline pattern the account
  // and recurring-payment deletes already use, rather than window.confirm.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const editable = Boolean(onEdit && onDelete);

  if (transactions.length === 0) {
    return (
      <div className={className}>
        <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <ul className={`space-y-2 ${className}`}>
      {transactions.map((transaction) => {
        const income = isIncome(transaction.category);
        const confirming = confirmingId === transaction.id;

        return (
          <li key={transaction.id} className="rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <CategoryIcon category={transaction.category} className="mt-0.5 h-6 w-6 shrink-0" />
              {/* min-w-0 is required here or the truncate below never fires. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {transaction.description || displayCategory(transaction.category)}
                  </p>
                  <p
                    className={`shrink-0 text-sm font-semibold ${
                      income ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {income ? "+" : "-"}
                    {formatCurrency(transaction.amount)}
                  </p>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {displayCategory(transaction.category)} ·{" "}
                  {accountNameById[transaction.account_id] || "Unknown"} ·{" "}
                  {formatDate(transaction.date)}
                </p>
              </div>
            </div>

            {editable && !confirming && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit!(transaction)}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700"
                >
                  <img src="/edit.svg" alt="" className="h-4 w-4" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(transaction.id)}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-700"
                >
                  <img src="/delete-black.svg" alt="" className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}

            {editable && confirming && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">Delete this transaction?</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete!(transaction);
                      setConfirmingId(null);
                    }}
                    className="h-11 flex-1 rounded-lg bg-red-600 text-sm font-medium text-white"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="h-11 flex-1 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
