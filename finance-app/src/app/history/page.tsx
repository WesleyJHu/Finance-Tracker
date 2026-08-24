"use client";

import { useMemo, useState } from "react";
import TabNav from "../../components/TabNav";
import BottomTabBar from "../../components/BottomTabBar";
import TransactionList from "../../components/TransactionList";
import SettingsModal from "../../components/SettingsModal";
import ProgressBar from "../../components/ProgressBar";
import CategoryIcon from "../../components/CategoryIcon";
import SignOutButton from "../../components/SignOutButton";
import PeriodSelector, { type PeriodValue } from "../../components/PeriodSelector";
import { formatCurrency, formatDate } from "@/lib/format";
import { displayCategory } from "@/lib/categories";
import { isIncome } from "@/lib/accounting";
import { todayInAppTz, previousMonth } from "@/lib/dates";
import { useHistoryData } from "@/hooks/useHistoryData";

const ALL = "all";

export default function History() {
  const today = useMemo(() => todayInAppTz(), []);
  const [period, setPeriod] = useState<PeriodValue>(() => {
    const { year, month } = previousMonth(today);
    return { mode: "month", month, year };
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [accountFilter, setAccountFilter] = useState<string>(ALL);

  const { transactions, accounts, balance, loading, error } = useHistoryData(period);

  const totalExpenses = transactions
    .filter((t) => !isIncome(t.category))
    .reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = transactions
    .filter((t) => isIncome(t.category))
    .reduce((sum, t) => sum + t.amount, 0);

  const categoryTotals = transactions.reduce<Record<string, number>>((totals, transaction) => {
    if (isIncome(transaction.category)) return totals;
    const category = transaction.category || "Uncategorized";
    totals[category] = (totals[category] || 0) + transaction.amount;
    return totals;
  }, {});

  // Unlike the dashboard, this covers a whole month or year of data, so every
  // category is shown rather than truncating to a top-5.
  const sortedCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount]) => ({ category, amount }));

  const maxCategoryAmount = sortedCategories.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  const accountNameById = Object.fromEntries(accounts.map((account) => [account.id, account.name]));

  const filteredTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          (categoryFilter === ALL || transaction.category === categoryFilter) &&
          (accountFilter === ALL || transaction.account_id === accountFilter)
      ),
    [transactions, categoryFilter, accountFilter]
  );

  const filtersActive = categoryFilter !== ALL || accountFilter !== ALL;

  const presentCategories = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.category))).sort(),
    [transactions]
  );

  const periodLabel =
    period.mode === "month"
      ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
          new Date(Date.UTC(period.year, period.month - 1, 1))
        )
      : String(period.year);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="flex items-center justify-center h-screen max-md:h-[calc(100dvh-3rem)]">
          <p className="text-2xl text-slate-600">Loading history...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="flex items-center justify-center h-screen max-md:h-[calc(100dvh-3rem)]">
          <p className="text-2xl text-red-600">Error: {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between mb-8 max-md:mb-6">
        <TabNav
          active="history"
          onSettingsClick={() => setShowSettingsModal(true)}
          className="max-md:hidden"
        />
        <SignOutButton className="max-md:w-full max-md:inline-flex max-md:items-center max-md:justify-center max-md:min-h-11" />
      </header>

      <section className="mb-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between max-md:gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500 max-md:tracking-[0.15em]">History</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900 max-md:text-2xl">{periodLabel}</h1>
          </div>
          <PeriodSelector value={period} onChange={setPeriod} today={today} className="max-md:w-full" />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2 mb-8 max-md:gap-4">
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200 max-md:p-5">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500 max-md:tracking-[0.15em]">Starting / Ending Balance</p>
          {balance === null ? (
            <div className="mt-6 rounded-3xl bg-slate-50 p-4 text-center text-sm text-slate-500 max-md:p-3">
              No data for this period
            </div>
          ) : (
            // max-sm, not max-md: two text-3xl figures still fit side by side
            // in a full-width card between 640 and 767.
            <div className="mt-5 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <div>
                <p className="text-sm text-slate-500">Starting</p>
                <p className="mt-1 text-3xl font-bold text-slate-900 max-md:text-2xl">
                  {balance.starting_balance === null ? "—" : formatCurrency(balance.starting_balance)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Ending</p>
                {balance.ending_balance === null ? (
                  <div className="mt-1 inline-flex rounded-3xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 max-md:px-3 max-md:py-1.5">
                    Not yet available
                  </div>
                ) : (
                  <p className="mt-1 text-3xl font-bold text-slate-900 max-md:text-2xl">
                    {formatCurrency(balance.ending_balance)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200 max-md:p-5">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500 max-md:tracking-[0.15em]">Total Income</p>
          <p className="mt-5 text-3xl font-bold text-slate-900 max-md:text-2xl">{formatCurrency(totalIncome)}</p>
          <p className="mt-3 text-sm text-slate-500">Total expenses: {formatCurrency(totalExpenses)}</p>
        </div>
      </section>

      <section className="mb-8">
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200 max-md:p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500 max-md:tracking-[0.15em]">Spending Categories</p>
            <p className="text-sm font-semibold text-slate-900">{formatCurrency(totalExpenses)}</p>
          </div>
          <div className="mt-6 space-y-5 max-md:space-y-4">
            {sortedCategories.length === 0 ? (
              <p className="text-sm text-slate-500">No category spend data yet.</p>
            ) : (
              sortedCategories.map((entry) => (
                <div key={entry.category}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">
                      {displayCategory(entry.category)}
                    </span>
                    <span className="text-sm text-slate-500">{formatCurrency(entry.amount)}</span>
                  </div>
                  <ProgressBar
                    className="mt-2"
                    percent={Math.round((entry.amount / maxCategoryAmount) * 100)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200 max-md:p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6 max-md:gap-3 max-md:mb-4">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500 max-md:tracking-[0.15em]">Transaction History</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900 max-md:text-xl">{periodLabel}</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition max-md:w-full max-md:min-h-11 ${
              filtersActive
                ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            {filtersActive ? `Filter (${filteredTransactions.length})` : "Filter"}
          </button>
        </div>

        {showFilters && (
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end max-md:p-3 max-md:gap-3">
            <div className="flex-1">
              <label htmlFor="filter-category" className="block text-sm font-medium text-slate-700 mb-1">
                Category
              </label>
              <select
                id="filter-category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-slate-500 focus:outline-none max-md:text-base max-md:min-h-11"
              >
                <option value={ALL}>All categories</option>
                {presentCategories.map((category) => (
                  <option key={category} value={category}>
                    {displayCategory(category)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="filter-account" className="block text-sm font-medium text-slate-700 mb-1">
                Account
              </label>
              <select
                id="filter-account"
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-slate-500 focus:outline-none max-md:text-base max-md:min-h-11"
              >
                <option value={ALL}>All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter(ALL);
                setAccountFilter(ALL);
              }}
              disabled={!filtersActive}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 max-md:w-full max-md:min-h-11"
            >
              Clear
            </button>
          </div>
        )}

        {/* Read-only: no onEdit/onDelete, so no actions row is rendered. */}
        <TransactionList
          className="md:hidden"
          transactions={filteredTransactions.toReversed()}
          accountNameById={accountNameById}
          emptyMessage={
            transactions.length === 0
              ? "No transactions in this period."
              : "No transactions match these filters."
          }
        />

        <div className="overflow-x-auto max-md:hidden">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="text-sm uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    {transactions.length === 0
                      ? "No transactions in this period."
                      : "No transactions match these filters."}
                  </td>
                </tr>
              )}
              {filteredTransactions.toReversed().map((transaction) => (
                <tr key={transaction.id} className="transition hover:bg-slate-100 border-b-8 border-white">
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-800 rounded-l-2xl">
                    <div className="flex items-center gap-2">
                      <CategoryIcon category={transaction.category} className="h-6 w-6" />
                      <span>{transaction.description || transaction.category}</span>
                    </div>
                  </td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500 uppercase">{transaction.category}</td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    {accountNameById[transaction.account_id] || "Unknown"}
                  </td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">{formatDate(transaction.date)}</td>
                  <td
                    className={`bg-slate-50 px-4 py-4 text-right text-sm font-semibold rounded-r-2xl ${
                      isIncome(transaction.category) ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {isIncome(transaction.category) ? "+" : "-"}
                    {formatCurrency(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} accounts={accounts} />
      )}

      {/* Clears the fixed bottom bar so the last card is never behind it. */}
      <div aria-hidden="true" className="md:hidden h-[calc(env(safe-area-inset-bottom)+4rem)]" />
      <BottomTabBar active="history" onSettingsClick={() => setShowSettingsModal(true)} />
    </main>
  );
}
