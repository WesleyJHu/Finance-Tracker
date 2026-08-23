"use client";

import React, { useState } from "react";
import Modal from "./Modal";
import { isCreditAccount as isCreditAccountType } from "@/lib/accountTypes";
import type { Account } from "@/types/api";

interface EditAccountModalProps {
  id: string;
  name: string;
  type: string;
  balance: number;
  max: number;
  onClose: () => void;
  onUpdate?: (account: Account) => void;
  onDelete?: (id: string) => void;
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
  const [accountBalance, setAccountBalance] = useState(Math.abs(balance).toString());
  const [accountMax, setAccountMax] = useState(max.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!accountName.trim() || !accountType.trim()) {
      setError("Name and type are required.");
      return;
    }

    const parsedBalance = isCreditAccountType(accountType) ? -Math.abs(Number(accountBalance)) : Math.abs(Number(accountBalance));
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
      onUpdate?.(updatedAccount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setLoading(false);
    }
  };

  // Archives rather than deletes: the account's transactions stay in history.
  // The API keeps the DELETE verb, so the request shape is unchanged.
  const handleArchive = async () => {
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
        throw new Error(data?.error || "Failed to archive account");
      }

      onDelete?.(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive account");
    } finally {
      setLoading(false);
      setConfirmingArchive(false);
    }
  };

  return (
    <Modal onClose={onClose} size="form" title="Edit Account" description="Update account name, type, or balance.">

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
              placeholder="Account balance"
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

          {confirmingArchive && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">
                Archive this account? It will be hidden everywhere, but its
                transactions stay in your history and still count toward monthly totals.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleArchive}
                  disabled={loading}
                >
                  {loading ? "Archiving..." : "Archive account"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  onClick={() => setConfirmingArchive(false)}
                  disabled={loading}
                >
                  Keep account
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between gap-3">
            <button
              type="button"
              title="Archive account"
              aria-label="Archive account"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setConfirmingArchive(true)}
              disabled={loading || confirmingArchive}
            >
              <img src="/delete.svg" alt="Archive" className="h-4 w-4" />
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
    </Modal>
  );
};

export default EditAccountModal;
