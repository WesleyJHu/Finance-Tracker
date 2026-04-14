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
  size = 150,
  strokeWidth = 20,
  onUpdate,
  onDelete,
}) => {
  const [accountName, setAccountName] = useState(name);
  const [accountType, setAccountType] = useState(type);
  const [isOpen, setIsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value / limit, 0), 1);
  const offset = circumference * (1 - progress);

  const handleAccountUpdate = (updated: { id: string; name: string; type: string; balance?: number; max?: number }) => {
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
      {/* CARD */}
      <div
        onClick={() => setIsOpen(true)}
        className={`
          relative
          bg-accent
          rounded-lg
          border-4
          cursor-pointer
          transition
          w-100 h-65
          ${
            isOpen
              ? "border-blue-500 ring-4 ring-blue-300"
              : "border-black hover:shadow-lg"
          }
        `}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
          className="absolute right-3 top-3 z-10 rounded-md bg-white px-3 py-1 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
        >
          Edit
        </button>

        {/* Title */}
        <div className="text-center font-bold text-4xl border-b-4 border-black p-2">
          {accountName}
        </div>

        {/* Donut + numbers */}
        <div className="flex items-center justify-center pt-4 pr-4">
          <svg width={size} height={size} className="mr-10">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#2bed21"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#ff2e1f"
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </svg>

          <div className="flex flex-col text-center font-bold text-4xl">
            <span>{formatCurrency(value)}</span>
            <span className="border-t-4 border-black">
              {formatCurrency(limit)}
            </span>
          </div>
        </div>

        <div className="text-center text-md text-gray-500">
          {accountType} • {formatCurrency(limit - value)} remaining
        </div>
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
