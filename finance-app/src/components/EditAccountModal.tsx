"use client";

import React, { useState } from "react";

interface EditAccountModalProps {
  id: string;
  name: string;
  type: string;
  balance: number;
  max: number;
  onClose: () => void;
  onUpdate: (account: { id: string; name: string; type: string; balance: number; max?: number }) => void;
  onDelete: (id: string) => void;
}

const EditAccountModal: React.FC<EditAccountModalProps> = ({
  id,
  name,
  type,
  balance,
  max,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const [accountName, setAccountName] = useState(name);
  const [accountType, setAccountType] = useState(type);
  const [accountBalance, setAccountBalance] = useState(balance.toString());
  const [accountMax, setAccountMax] = useState(max.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!accountName.trim() || !accountType.trim()) {
      setError("Name and type are required.");
      return;
    }

    const parsedBalance = Number(accountBalance);
    const parsedMax = Number(accountMax);
    if (isNaN(parsedBalance)) {
      setError("Balance must be a valid number.");
      return;
    }
    if (isNaN(parsedMax)) {
      setError("Max must be a valid number.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/accounts", {
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

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Failed to update account");
      }

      const updatedAccount = await res.json();
      onUpdate(updatedAccount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this account? This action cannot be undone.")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Failed to delete account");
      }

      onDelete(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
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
            <h2 className="text-2xl font-bold">Edit Account</h2>
            <p className="text-sm text-gray-500">Update account name, type, or balance.</p>
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
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-name">
              Name
            </label>
            <input
              id="account-name"
              type="text"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Account name"
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
              placeholder="Account type"
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
              placeholder="Account max"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-between gap-3">
            <button
              type="button"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleDelete}
              disabled={loading}
            >
              Delete account
            </button>
            <div className="flex gap-3">
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
                disabled={loading}
              >
                {loading ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditAccountModal;
