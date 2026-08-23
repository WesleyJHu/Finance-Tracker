"use client";

import { useCallback, useEffect, useState } from "react";
import { todayInAppTz } from "@/lib/dates";
import type { Account, BalanceSnapshot, MonthlyBudget, Transaction } from "@/types/api";

/**
 * Loads everything the dashboard renders.
 *
 * Lifted out of page.tsx, where the four endpoints were awaited one after
 * another even though none depends on another — a pure four-request waterfall.
 * They now run together, the pattern SettingsModal already used.
 *
 * `refresh` lets the settings modal push budget edits back to the dashboard,
 * which previously stayed stale until a full page reload.
 */
export interface DashboardData {
  accounts: Account[];
  transactions: Transaction[];
  monthlyBudget: MonthlyBudget | null;
  balanceSnapshot: BalanceSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Today, in the app's timezone. */
  today: { year: number; month: number; day: number };
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  refresh: () => Promise<void>;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${what}`);
  return res.json() as Promise<T>;
}

export function useDashboardData(): DashboardData {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState<MonthlyBudget | null>(null);
  const [balanceSnapshot, setBalanceSnapshot] = useState<BalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayInAppTz());

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const now = todayInAppTz();
      setToday(now);

      const { month, year } = now;

      // A missing snapshot row is expected on the 1st of a month before the
      // cron job runs, so it is fetched separately and never fails the page.
      const snapshotPromise = getJson<BalanceSnapshot[]>(
        `/api/balance_snapshot?month=${month}&year=${year}`,
        "balance snapshot"
      ).catch((err) => {
        console.error("Failed to fetch balance snapshot", err);
        return [] as BalanceSnapshot[];
      });

      const [accountsData, transactionsData, budgetData, snapshotData] = await Promise.all([
        getJson<Account[]>("/api/accounts", "accounts"),
        getJson<Transaction[]>(`/api/transactions?month=${month}&year=${year}`, "transactions"),
        getJson<MonthlyBudget[]>(`/api/monthly_budgets?month=${month}`, "budget"),
        snapshotPromise,
      ]);

      setAccounts(accountsData);
      setTransactions(transactionsData);
      setMonthlyBudget(budgetData.length > 0 ? budgetData[0] : null);
      setBalanceSnapshot(snapshotData.length > 0 ? snapshotData[0] : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      console.error("Dashboard fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    accounts,
    transactions,
    monthlyBudget,
    balanceSnapshot,
    loading,
    error,
    today,
    setAccounts,
    setTransactions,
    refresh,
  };
}
