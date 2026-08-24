"use client";

import React, { useState } from "react";
import AccountModal from "./AccountModal";
import EditAccountModal from "./EditAccountModal";
import ProgressBar from "./ProgressBar";
import { isCreditAccount } from "@/lib/accountTypes";
import { formatCurrency } from "@/lib/format";
import type { Account } from "@/types/api";

// Props mirror the database columns. The old types/card.ts renamed `max` to
// `limit` and `balance` to `value`, which gave the same two columns a third
// set of names and made the data model harder to follow than it needed to be.
export interface AccountCardProps {
  account: Account;
  onUpdate?: (account: Account) => void;
  onDelete?: (id: string) => void;
  /** Sizing from the caller — the dashboard makes these carousel slides on mobile. */
  className?: string;
}

const Card: React.FC<AccountCardProps> = ({ account, onUpdate, onDelete, className = "" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Rendered straight from props. The card used to mirror name and type into
  // its own state, which made it a second source of truth alongside the
  // dashboard's `accounts` and left the two able to disagree.
  const { id, balance, max } = account;
  const accountName = account.name ?? "";
  const accountType = account.type ?? "";

  // `max` means two different things depending on the account, and the card
  // used to render both as "N% limit used" — which is meaningless on a
  // checking account, where `max` is cumulative income received, not a limit.
  // Same bar, same caption slot, honest label.
  const isCredit = isCreditAccount(accountType);
  const percent = max ? Math.round((Math.abs(balance) / max) * 100) : 0;
  const caption = isCredit
    ? `${percent}% limit used`
    : max
      ? `${percent}% of income received still held`
      : "No income recorded yet";

  return (
    <>
      <div className={`relative rounded-3xl bg-white p-6 shadow-sm border border-slate-200 cursor-pointer ${className}`} onClick={() => setIsOpen(true)}>
        <button
          type="button"
          title="Edit account"
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
          className="absolute right-3 top-3 z-10 rounded-md bg-white px-3 py-1 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100 max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center max-md:px-2"
        >
          <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
        </button>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{accountType}</p>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">{accountName}</h2>
        <p className="mt-3 text-sm text-slate-500">{formatCurrency(Math.abs(balance))} / {formatCurrency(max)}</p>
        <ProgressBar className="mt-4" percent={percent} gradient="blue" />
        <p className="mt-2 text-sm text-slate-500">{caption}</p>
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
