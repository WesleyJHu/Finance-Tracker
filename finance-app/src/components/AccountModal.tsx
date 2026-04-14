"use client";

import React, { useEffect, useState } from "react";

interface Transaction {
  id: string;
  date: string;
  amount: number;
  description?: string;
  category: string;
  account_id: string;
  merchant?: string;
}

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
        const res = await fetch(`/api/transactions?account=${accountId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch transactions");
        }
        const data = await res.json();
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

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
                        {tx.merchant || tx.description || tx.category}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(tx.date)} • {tx.category}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${
                        tx.amount >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
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