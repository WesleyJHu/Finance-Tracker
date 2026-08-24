"use client";

import React from "react";
import { formatCurrency } from "@/lib/format";
import type { MonthlyTotal } from "@/types/api";

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The h-40 the tallest hardcoded bar used, in pixels (40 x 0.25rem x 16px).
 *
 * Still the reference scale, but the container's height is now a class
 * (`h-40`, the same 160px) rather than an inline style, so a breakpoint can
 * shrink it on a phone. Bars are sized as a percentage of that container.
 */
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
      <div className={`flex items-end h-40 max-md:h-28 ${className}`}>
        <p className="text-sm text-slate-500">No spending history yet.</p>
      </div>
    );
  }

  // Scaled against the tallest month rather than an absolute figure, so the
  // chart stays readable whatever the amounts are.
  const peak = totals.reduce((max, entry) => Math.max(max, entry.expenses), 0);

  return (
    <div className={`flex items-end gap-2 h-40 max-md:h-28 ${className}`}>
      {totals.map((entry) => {
        // Rounded to whole pixels against the 160px reference first, then
        // expressed as a percentage of the container. Taking the percentage
        // straight from the ratio would drop this rounding and shift every
        // bar by a sub-pixel against how it renders today.
        const px =
          peak > 0
            ? Math.max(Math.round((entry.expenses / peak) * MAX_BAR_PX), MIN_BAR_PX)
            : MIN_BAR_PX;
        const label = `${MONTH_ABBREVIATIONS[entry.month - 1]} ${entry.year}`;

        return (
          <div
            key={`${entry.year}-${entry.month}`}
            className="w-full rounded-xl bg-slate-800"
            style={{ height: `${(px / MAX_BAR_PX) * 100}%` }}
            title={`${label}: ${formatCurrency(entry.expenses)}`}
          >
            <span className="sr-only">{`${label}: ${formatCurrency(entry.expenses)}`}</span>
          </div>
        );
      })}
    </div>
  );
}
