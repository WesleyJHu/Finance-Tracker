"use client";

import React from "react";

/**
 * The bar rendered three times with identical markup: the dashboard's spending
 * progress, each category row, and the account card.
 *
 * `gradient` exists because AccountCard uses from-blue-600 while the dashboard
 * uses from-sky-500. Both are preserved exactly rather than unified, so no
 * pixels move.
 */
const GRADIENTS = {
  sky: "bg-linear-to-r from-sky-500 to-cyan-400",
  blue: "bg-linear-to-r from-blue-600 to-cyan-400",
} as const;

export interface ProgressBarProps {
  /** 0-100. Clamped, so callers do not each repeat Math.min. */
  percent: number;
  gradient?: keyof typeof GRADIENTS;
  /** Track spacing, e.g. "mt-2" or "mt-4". */
  className?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  gradient = "sky",
  className = "",
}) => {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const track = `h-2 overflow-hidden rounded-full bg-slate-100${className ? ` ${className}` : ""}`;

  return (
    <div className={track}>
      <div
        className={`h-full rounded-full ${GRADIENTS[gradient]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export default ProgressBar;
