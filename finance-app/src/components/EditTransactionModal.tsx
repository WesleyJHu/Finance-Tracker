"use client";

import React, { useEffect, useState } from "react";

interface AccountOption {
  id: string;
  name: string;
  type?: string;
}

interface TransactionData {
  id: string;
  date: string;
  amount: number;
  description?: string;
  category: string;
  account_id: string;
}

interface EditTransactionModalProps {
  transaction: TransactionData;
  accounts: AccountOption[];
  onClose: () => void;
  onUpdate: (transaction: TransactionData) => void;
}

const categories = [
  "Income",
  "Grocery",
  "Food",
  "Tech",
  "Transportation",
  "Entertainment",
  "Bills",
  "Misc",
];

const formatCategoryName = (category: string) =>
  category.charAt(0).toUpperCase() + category.slice(1);

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  transaction,
  accounts,
  onClose,
  onUpdate,
}) => {
  const [transactionDate, setTransactionDate] = useState(
    transaction.date.slice(0, 10)
  );
  const [amount, setAmount] = useState(transaction.amount.toFixed(2));
  const [description, setDescription] = useState(transaction.description ?? "");
  const [category, setCategory] = useState(
    formatCategoryName(transaction.category)
  );
  const [accountId, setAccountId] = useState(transaction.account_id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTransactionDate(transaction.date.slice(0, 10));
    setAmount(transaction.amount.toFixed(2));
    setDescription(transaction.description ?? "");
    setCategory(formatCategoryName(transaction.category));
    setAccountId(transaction.account_id);
  }, [transaction]);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const isCreditAccount = selectedAccount?.type?.toLowerCase().includes("credit");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!transactionDate || !category || !accountId) {
      setError("Date, category, and account are required.");
      return;
    }

    if (isCreditAccount && category.toLowerCase() === "income") {
      setError("Credit accounts cannot receive Income transactions.");
      return;
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount)) {
      setError("Amount must be a valid number.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: transaction.id,
          date: transactionDate,
          amount: parsedAmount,
          description: description.trim() || null,
          category: category.toLowerCase(),
          account_id: accountId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Failed to update transaction");
      }

      const updatedTransaction = await res.json();
      onUpdate({
        ...updatedTransaction,
        amount: Number(updatedTransaction.amount),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update transaction");
      console.error("PATCH /transactions failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-[90vw] max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Edit Transaction</h2>
            <p className="text-sm text-gray-500">Update the details of your transaction.</p>
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-transaction-date">
              Date
            </label>
            <input
              id="edit-transaction-date"
              type="date"
              value={transactionDate}
              onChange={(event) => setTransactionDate(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-transaction-amount">
              Amount
            </label>
            <input
              id="edit-transaction-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-transaction-description">
              Description
            </label>
            <input
              id="edit-transaction-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Description or note"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-transaction-category">
              Category
            </label>
            <select
              id="edit-transaction-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            >
              {categories.map((option) => (
                <option key={option} value={option} disabled={isCreditAccount && option === "Income"}>
                  {option}
                </option>
              ))}
            </select>
            {isCreditAccount && (
              <p className="mt-2 text-xs text-gray-500">
                Income is not allowed for credit accounts.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-transaction-account">
              Account
            </label>
            <select
              id="edit-transaction-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            >
              {accounts.length === 0 ? (
                <option value="">No accounts available</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading || accounts.length === 0}
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditTransactionModal;
