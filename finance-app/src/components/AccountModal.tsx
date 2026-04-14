"use client";

import React, { useState } from "react";
import type { Transaction } from "@/types/transaction";

interface AccountModalProps {
  id: string;
  name: string;
  type: string;
  balance: number;
  max: number;
  transactions: Transaction[];
  loading?: boolean;
  onClose: () => void;
  onUpdate: (account: { id: string; name: string; type: string; balance: number; max?: number }) => void;
  onDelete: (id: string) => void;
}

const AccountModal: React.FC<AccountModalProps> = ({
  id,
  name,
  type,
  balance,
  max,
  transactions,
  loading,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const [accountName, setAccountName] = useState(name);
  const [accountType, setAccountType] = useState(type);
  const [accountBalance, setAccountBalance] = useState(balance.toString());
  const [accountMax, setAccountMax] = useState(max.toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

  const handleSave = async () => {
    setError(null);
    const parsedBalance = Number(accountBalance);

    if (!accountName.trim() || !accountType.trim()) {
      setError("Name and type are required.");
      return;
    }

    if (isNaN(parsedBalance)) {
      setError("Balance must be a valid number.");
      return;
    }

    const parsedMax = Number(accountMax);
    if (isNaN(parsedMax)) {
      setError("Max must be a valid number.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/accounts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          name: accountName.trim(),
          type: accountType.trim(),
          balance: parsedBalance,
          max: parsedMax,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || "Failed to update account.");
      }

      const updatedAccount = await response.json();
      onUpdate(updatedAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this account? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch("/api/accounts", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || "Failed to delete account.");
      }

      onDelete(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account.");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-100 max-w-xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">{accountName} Transactions</h2>
            <p className="text-sm text-gray-500">Edit account info, update balance, or delete the account.</p>
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-name">
              Name
            </label>
            <input
              id="account-name"
              type="text"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-type">
              Type
            </label>
            <input
              id="account-type"
              type="text"
              value={accountType}
              onChange={(event) => setAccountType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-balance">
              Balance
            </label>
            <input
              id="account-balance"
              type="number"
              step="0.01"
              value={accountBalance}
              onChange={(event) => setAccountBalance(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-max">
              Max
            </label>
            <input
              id="account-max"
              type="number"
              step="0.01"
              value={accountMax}
              onChange={(event) => setAccountMax(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="space-y-6 mb-6">
          <div className="flex justify-between items-center gap-4 p-4 rounded-lg bg-gray-50 border border-gray-200">
            <div>
              <p className="text-sm text-gray-500">Current balance</p>
              <p className="text-xl font-semibold text-gray-900">{formatCurrency(balance)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Max</p>
              <p className="text-xl font-semibold text-gray-900">{formatCurrency(max)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Transactions</p>
              <p className="text-xl font-semibold text-gray-900">{transactions.length}</p>
            </div>
          </div>

          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex justify-between border-b pb-1 text-sm"
              >
                <div>
                  <div className="font-medium">{tx.merchant}</div>
                  <div className="text-gray-500 text-xs">
                    {tx.category} • {tx.date}
                  </div>
                </div>
                <span className="font-semibold">${tx.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between gap-3">
          <button
            type="button"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            onClick={handleDelete}
          >
            Delete account
          </button>
          <button
            type="button"
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountModal;
