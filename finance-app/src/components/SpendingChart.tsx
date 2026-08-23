"use client";

import React from "react";
import { formatCurrency } from "@/lib/format";
import type { MonthlyTotal } from "@/types/api";

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The h-40 the tallest hardcoded bar used, in pixels (40 x 0.25rem x 16px). */
const MAX_BAR_PX = 160;
/** Enough that an empty month is still a visible bar rather than a gap. */
const MIN_BAR_PX = 8;

interface SpendingChartProps {
  /** Oldest first, one entry per month. */
  totals: MonthlyTotal[];
  className?: string;
}

/**
 * Monthly expense totals as a bar chart.
 *
 * This replaces six hardcoded `<div>`s on a fixed h-20 -> h-40 ladder that
 * rendered the same rising staircase no matter what the data said — the most
 * visible piece of fiction on the dashboard, since it read as six months of
 * steadily increasing spending.
 *
 * The bars keep the original styling exactly (`bg-slate-800`, `rounded-xl`,
 * `w-full`, `gap-2`) and the tallest still tops out at the old h-40, so the
 * card's height does not change.
 */
export default function SpendingChart({ totals, className = "" }: SpendingChartProps) {
  if (totals.length === 0) {
    // Reserves the same vertical space, so the card does not resize while the
    // request is in flight or after it fails.
    return (
      <div className={`flex items-end ${className}`} style={{ height: MAX_BAR_PX }}>
        <p className="text-sm text-slate-500">No spending history yet.</p>
      </div>
    );
  }

  // Scaled against the tallest month rather than an absolute figure, so the
  // chart stays readable whatever the amounts are.
  const peak = totals.reduce((max, entry) => Math.max(max, entry.expenses), 0);

  return (
    <div className={`flex items-end gap-2 ${className}`} style={{ height: MAX_BAR_PX }}>
      {totals.map((entry) => {
        const height =
          peak > 0
            ? Math.max(Math.round((entry.expenses / peak) * MAX_BAR_PX), MIN_BAR_PX)
            : MIN_BAR_PX;
        const label = `${MONTH_ABBREVIATIONS[entry.month - 1]} ${entry.year}`;

        return (
          <div
            key={`${entry.year}-${entry.month}`}
            className="w-full rounded-xl bg-slate-800"
            style={{ height }}
            title={`${label}: ${formatCurrency(entry.expenses)}`}
          >
            <span className="sr-only">{`${label}: ${formatCurrency(entry.expenses)}`}</span>
          </div>
        );
      })}
    </div>
  );
}
