"use client";

import React, { useState } from "react";

interface CreateAccountModalProps {
  onClose: () => void;
  onCreate: (account: { id: string; name: string; type: string; balance: number; max: number }) => void;
}

const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  onClose,
  onCreate,
}) => {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountBalance, setAccountBalance] = useState("0");
  const [accountMax, setAccountMax] = useState("6500");
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: accountName.trim(),
          type: accountType.trim(),
          balance: parsedBalance,
          max: parsedMax,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Failed to create account");
      }

      const newAccount = await res.json();
      onCreate(newAccount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
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
            <h2 className="text-2xl font-bold">Create New Account</h2>
            <p className="text-sm text-gray-500">Add a new account or card to track.</p>
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
              required
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
              placeholder="e.g., Credit Card, Checking"
              required
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
              placeholder="Current balance"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account-max">
              Max Limit
            </label>
            <input
              id="account-max"
              type="number"
              step="0.01"
              value={accountMax}
              onChange={(event) => setAccountMax(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Credit limit or max balance"
              required
            />
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
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateAccountModal;