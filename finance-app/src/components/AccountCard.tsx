"use client";

import type { CardProps } from "@/types/card";

import React, { useState } from "react";
import AccountModal from "./AccountModal";
import EditAccountModal from "./EditAccountModal";

const Card: React.FC<CardProps> = ({
  id,
  name,
  type,
  limit,
  value,
  onUpdate,
  onDelete,
}) => {
  const [accountName, setAccountName] = useState(name);
  const [accountType, setAccountType] = useState(type);
  const [isOpen, setIsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const limitUsed = limit ? Math.round((Math.abs(value) / limit) * 100) : 0;

  const handleAccountUpdate = (updated: { id: string; name: string; type: string; balance: number; max?: number }) => {
    setAccountName(updated.name);
    setAccountType(updated.type);
    onUpdate?.(updated);
  };

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

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
        <p className="mt-3 text-sm text-slate-500">{formatCurrency(Math.abs(value))} / {formatCurrency(limit)}</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-linear-to-r from-blue-600 to-cyan-400" style={{ width: `${Math.min(limitUsed, 100)}%` }} />
        </div>
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
          balance={value}
          max={limit}
          onClose={() => setEditOpen(false)}
          onUpdate={handleAccountUpdate}
          onDelete={(deletedId) => onDelete?.(deletedId)}
        />
      )}
    </>
  );
};

export default Card;
