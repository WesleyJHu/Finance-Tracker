"use client";

import type { Transaction } from "@/types/transaction";
import type { CardProps } from "@/types/card";

import React, { useState } from "react";
import AccountModal from "./AccountModal";

const Card: React.FC<CardProps> = ({
  name,
  limit,
  value,
  size = 150,
  strokeWidth = 20,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const openModal = async () => {
    setIsOpen(true);
    setLoading(true);

    try {
      const month = new Date().toISOString().slice(0, 7);
      const res = await fetch(
        `/api/transactions?account=${name}&month=${month}`
      );
      const data = await res.json();
      setTransactions(data);
    } catch (err) {
      console.error("Failed to fetch transactions", err);
    } finally {
      setLoading(false);
    }
  };

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value / limit, 0), 1);
  const offset = circumference * (1 - progress);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

  return (
    <>
      {/* CARD */}
      <div
        onClick={openModal}
        className={`
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
        {/* Title */}
        <div className="text-center font-bold text-4xl border-b-4 border-black p-2">
          {name}
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
          {formatCurrency(limit - value)} remaining
        </div>
      </div>

      {/* MODAL */}
      {isOpen && (
        <AccountModal
          name={name}
          value={formatCurrency(value)}
          transactions={transactions}
          loading={loading}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default Card;
