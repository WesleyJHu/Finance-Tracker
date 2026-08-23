"use client";

import React, { useEffect, useState } from "react";
import { todayInAppTz } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { isIncome } from "@/lib/accounting";
import type { Transaction } from "@/types/api";

interface AccountModalProps {
  accountId: string;
  accountName: string;
  onClose: () => void;
}

const AccountModal: React.FC<AccountModalProps> = ({
  accountId,
  accountName,
  onClose,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        setError(null);

        // Derived in the app's timezone rather than the browser's, so a viewer
        // outside ET sees the same month the rest of the dashboard does.
        const { month, year } = todayInAppTz();

        const res = await fetch(
          `/api/transactions?account=${accountId}&month=${month}&year=${year}`
        );

        if (!res.ok) {
          throw new Error("Failed to fetch transactions");
        }

        const data = await res.json();

        // No client-side re-filter: the API used to ignore month/year whenever
        // `account` was set and return the account's whole history, so this
        // component had to filter again in browser-local time. The API now
        // honours both, and filtering again here would drop edge-of-month rows.
        setTransactions(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [accountId]);

  // formatDate now comes from lib/format, which pins the app timezone. This
  // copy omitted it, so the same transaction could render one date here and a
  // different one in the dashboard table.
  const isIncomeTransaction = (transaction: Transaction) => isIncome(transaction.category);

  const displayAmount = (transaction: Transaction) => {
    const value = formatCurrency(Math.abs(transaction.amount));
    return isIncomeTransaction(transaction) ? `+${value}` : `-${value}`;
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">{accountName} Transactions</h2>
            <p className="text-sm text-gray-500">All transactions for this account</p>
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {loading && (
          <div className="text-center py-8">
            <p className="text-gray-600">Loading transactions...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <p className="text-red-600">Error: {error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-4">
            {transactions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No transactions on this account</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex justify-between items-center p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">
                        {tx.description || tx.category}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(tx.date)} • {tx.category}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${
                        isIncomeTransaction(tx) ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {displayAmount(tx)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountModal;