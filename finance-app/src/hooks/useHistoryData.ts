"use client";

import { useEffect, useState } from "react";
import type { Account, BalanceSnapshot, Transaction, YearBalanceSummary } from "@/types/api";

export interface HistoryPeriod {
  mode: "month" | "year";
  /** Meaningful only when mode === "month". */
  month: number;
  year: number;
}

export interface PeriodBalance {
  starting_balance: number | null;
  ending_balance: number | null;
}

export interface HistoryData {
  transactions: Transaction[];
  accounts: Account[];
  balance: PeriodBalance | null;
  loading: boolean;
  error: string | null;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${what}`);
  return res.json() as Promise<T>;
}

/**
 * Loads a past month's or past year's transactions, accounts, and
 * starting/ending balance for the History tab. Never mutates — this tab is
 * read-only, so unlike useDashboardData there is nothing to write back.
 */
export function useHistoryData(period: HistoryPeriod): HistoryData {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balance, setBalance] = useState<PeriodBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const transactionsUrl =
          period.mode === "month"
            ? `/api/transactions?month=${period.month}&year=${period.year}`
            : `/api/transactions?year=${period.year}`;
        const balanceUrl =
          period.mode === "month"
            ? `/api/balance_snapshot?month=${period.month}&year=${period.year}`
            : `/api/balance_snapshot?year=${period.year}`;

        // A missing snapshot is expected for a period with no data yet, so it
        // is fetched separately and never fails the page.
        const balancePromise = (
          period.mode === "month"
            ? getJson<BalanceSnapshot[]>(balanceUrl, "balance snapshot").then(
                (rows): PeriodBalance | null =>
                  rows.length > 0
                    ? { starting_balance: rows[0].starting_balance, ending_balance: rows[0].ending_balance }
                    : null
              )
            : getJson<YearBalanceSummary>(balanceUrl, "balance summary").then(
                (summary): PeriodBalance => ({
                  starting_balance: summary.starting_balance,
                  ending_balance: summary.ending_balance,
                })
              )
        ).catch((err) => {
          console.error("Failed to fetch balance for period", err);
          return null;
        });

        const [accountsData, transactionsData, balanceData] = await Promise.all([
          getJson<Account[]>("/api/accounts", "accounts"),
          getJson<Transaction[]>(transactionsUrl, "transactions"),
          balancePromise,
        ]);

        if (cancelled) return;
        setAccounts(accountsData);
        setTransactions(transactionsData);
        setBalance(balanceData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "An error occurred");
        console.error("History fetch failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [period.mode, period.month, period.year]);

  return { transactions, accounts, balance, loading, error };
}
