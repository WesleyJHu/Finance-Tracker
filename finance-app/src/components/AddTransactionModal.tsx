"use client";

import React, { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { isCreditAccount as isCreditAccountType } from "@/lib/accountTypes";
import { CATEGORIES, INCOME, displayCategory } from "@/lib/categories";
import { todayInAppTz, toDateString } from "@/lib/dates";
import type { AccountOption, Transaction, WithAccounts } from "@/types/api";

interface AddTransactionModalProps {
  accounts: AccountOption[];
  onClose: () => void;
  onCreate: (transaction: WithAccounts<Transaction>) => void;
}

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  accounts,
  onClose,
  onCreate,
}) => {
  const [transactionDate, setTransactionDate] = useState(() => {
    // The app's timezone, not the browser's: toISOString() is UTC, so after
    // 20:00 ET this defaulted to tomorrow's date.
    const today = todayInAppTz();
    return toDateString(today.year, today.month, today.day);
  });
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const isCreditAccount = isCreditAccountType(selectedAccount?.type);
  const availableCategories = useMemo(
    () => (isCreditAccount ? CATEGORIES.filter((option) => option !== INCOME) : CATEGORIES),
    [isCreditAccount]
  );

  useEffect(() => {
    if (isCreditAccount && category === INCOME) {
      setCategory(availableCategories[0]);
    }
  }, [isCreditAccount, category, availableCategories]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!transactionDate || !category || !accountId) {
      setError("Date, category, and account are required.");
      return;
    }

    if (isCreditAccount && category === INCOME) {
      setError("Credit accounts cannot receive Income transactions.");
      return;
    }

    if (amount.trim() === "") {
      setError("Amount is required.");
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: transactionDate,
          amount: parsedAmount,
          description: description.trim() || undefined,
          // Already the enum's lowercase form; see lib/categories.ts.
          category,
          account_id: accountId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Failed to create transaction");
      }

      const newTransaction = await res.json();
      onCreate(newTransaction);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create transaction");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} size="form" title="Add New Transaction" description="Log a new income or expense transaction.">

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="transaction-date">
              Date
            </label>
            <input
              id="transaction-date"
              type="date"
              value={transactionDate}
              onChange={(event) => setTransactionDate(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="transaction-amount">
              Amount
            </label>
            <input
              id="transaction-amount"
              type="number"
              step="1.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="transaction-description">
              Description
            </label>
            <input
              id="transaction-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Description or note"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="transaction-category">
              Category
            </label>
            <select
              id="transaction-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            >
              {/* Value is the enum's lowercase form; the label stays Title Case. */}
              {availableCategories.map((option) => (
                <option key={option} value={option}>
                  {displayCategory(option)}
                </option>
              ))}
            </select>
            {isCreditAccount && (
              <p className="mt-2 text-xs text-gray-500">
                Credit accounts cannot be used for Income transactions.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="transaction-account">
              Account
            </label>
            <select
              id="transaction-account"
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
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading || accounts.length === 0}
            >
              {loading ? "Adding..." : "Add Transaction"}
            </button>
          </div>
        </form>
    </Modal>
  );
};

export default AddTransactionModal;
