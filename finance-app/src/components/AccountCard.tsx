"use client";

import React, { useState } from "react";
import AccountModal from "./AccountModal";
import EditAccountModal from "./EditAccountModal";
import ProgressBar from "./ProgressBar";
import { formatCurrency } from "@/lib/format";
import type { Account } from "@/types/api";

// Props mirror the database columns. The old types/card.ts renamed `max` to
// `limit` and `balance` to `value`, which gave the same two columns a third
// set of names and made the data model harder to follow than it needed to be.
export interface AccountCardProps {
  account: Account;
  onUpdate?: (account: Account) => void;
  onDelete?: (id: string) => void;
}

const Card: React.FC<AccountCardProps> = ({ account, onUpdate, onDelete }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Rendered straight from props. The card used to mirror name and type into
  // its own state, which made it a second source of truth alongside the
  // dashboard's `accounts` and left the two able to disagree.
  const { id, balance, max } = account;
  const accountName = account.name ?? "";
  const accountType = account.type ?? "";
  const limitUsed = max ? Math.round((Math.abs(balance) / max) * 100) : 0;

  return (
    <>
      <div className="relative rounded-3xl bg-white p-6 shadow-sm border border-slate-200 cursor-pointer" onClick={() => setIsOpen(true)}>
        <button
          type="button"
          title="Edit account"
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
          className="absolute right-3 top-3 z-10 rounded-md bg-white px-3 py-1 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
        >
          <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
        </button>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{accountType}</p>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">{accountName}</h2>
        <p className="mt-3 text-sm text-slate-500">{formatCurrency(Math.abs(balance))} / {formatCurrency(max)}</p>
        <ProgressBar className="mt-4" percent={limitUsed} gradient="blue" />
        <p className="mt-2 text-sm text-slate-500">{limitUsed}% limit used</p>
      </div>

      {/* MODALS */}
      {isOpen && (
        <AccountModal
          accountId={id}
          accountName={accountName}
          onClose={() => setIsOpen(false)}
        />
      )}
      {editOpen && (
        <EditAccountModal
          id={id}
          name={accountName}
          type={accountType}
          balance={balance}
          max={max}
          onClose={() => setEditOpen(false)}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
    </>
  );
};

export default Card;
