"use client";

import React from "react";

interface BalanceCardProps {
  spending: number;
  budgetPlusIncome: number;
  size?: number;
  strokeWidth?: number;
}

const BalanceCard: React.FC<BalanceCardProps> = ({
  spending,
  budgetPlusIncome,
  size = 150,
  strokeWidth = 20,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = budgetPlusIncome > 0 ? Math.min(Math.max(spending / budgetPlusIncome, 0), 1) : 0;
  const offset = circumference * (1 - progress);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

  return (
    <div className="relative bg-accent rounded-lg border-4 border-black w-100 h-65">
      {/* Title */}
      <div className="text-center font-bold text-4xl border-b-4 border-black p-2">
        Balance
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
          <span>{formatCurrency(spending)}</span>
          <span className="border-t-4 border-black">
            {formatCurrency(budgetPlusIncome)}
          </span>
        </div>
      </div>

      <div className="text-center text-md text-gray-500">
        Spending • {formatCurrency(budgetPlusIncome - spending)} remaining
      </div>
    </div>
  );
};

export default BalanceCard;
