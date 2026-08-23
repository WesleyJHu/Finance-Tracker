"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '../components/AccountCard';
import CreateAccountModal from '../components/CreateAccountModal';
import AddTransactionModal from '../components/AddTransactionModal';
import EditTransactionModal from '../components/EditTransactionModal';
import SettingsModal from '../components/SettingsModal';
import ProgressBar from '../components/ProgressBar';
import CategoryIcon from '../components/CategoryIcon';
import SpendingChart from '../components/SpendingChart';
import { formatCurrency, formatDate, formatLongDate } from '@/lib/format';
import { displayCategory } from '@/lib/categories';
import { isIncome } from '@/lib/accounting';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Account, Transaction, WithAccounts } from '@/types/api';

const ALL = 'all';

export default function Dashboard() {
  const {
    accounts,
    transactions,
    monthlyBudget,
    balanceSnapshot,
    monthlyTotals,
    loading,
    error,
    today,
    setAccounts,
    setTransactions,
    refresh,
  } = useDashboardData();

  const { day, month, year } = today;

  const [pageError, setPageError] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // The Filter button was inert: no handler, no state, no dropdown. The
  // transaction list is entirely client-side, so filtering is just this.
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [accountFilter, setAccountFilter] = useState<string>(ALL);

  const handleAccountUpdate = (updatedAccount: Account) => {
    setAccounts(prev => prev.map(acc => acc.id === updatedAccount.id ? { ...acc, ...updatedAccount } : acc));
  };

  const handleAccountDelete = (id: string) => {
    setAccounts(prev => prev.filter(acc => acc.id !== id));
  };

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  /**
   * Merges the account rows the API returns after a mutation.
   *
   * This replaces a browser-side mirror of the server's balance formula
   * (getTransactionDelta / getTransactionMaxDelta / a duplicated credit-account
   * guard). The two implementations could drift, and displayed balances would
   * then silently disagree with the database until a reload. The mutating
   * transaction routes now return the affected accounts, so there is one
   * formula, on the server.
   */
  const applyServerAccounts = (updated: Account[] | undefined) => {
    if (!updated?.length) return;
    const byId = new Map(updated.map((account) => [account.id, account]));
    setAccounts((current) =>
      current.map((account) => byId.get(account.id) ?? account)
    );
  };

  const handleDeleteTransaction = async (transaction: Transaction) => {
    setPageError(null);
    try {
      const res = await fetch(`/api/transactions?id=${encodeURIComponent(transaction.id)}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete transaction');
      }

      setTransactions((current) => current.filter((t) => t.id !== transaction.id));
      applyServerAccounts(data?.accounts);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to delete transaction');
      console.error('Delete transaction failed:', err);
    }
  };

  const handleSaveTransaction = (updatedTransaction: WithAccounts<Transaction>) => {
    setTransactions((current) =>
      current.map((transaction) =>
        transaction.id === updatedTransaction.id ? updatedTransaction : transaction
      )
    );

    applyServerAccounts(updatedTransaction.accounts);
    setEditingTransaction(null);
  };

  const formattedDate = formatLongDate(year, month, day);

  const totalExpenses = transactions
    .filter((t) => !isIncome(t.category))
    .reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = transactions
    .filter((t) => isIncome(t.category))
    .reduce((sum, t) => sum + t.amount, 0);

  const categoryTotals = transactions.reduce<Record<string, number>>((totals, transaction) => {
    if (isIncome(transaction.category)) return totals;
    const category = transaction.category || 'Uncategorized';
    totals[category] = (totals[category] || 0) + transaction.amount;
    return totals;
  }, {});

  const sortedCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));

  const maxCategoryAmount = sortedCategories.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  // starting_balance already includes this month's base_budget — the snapshot
  // script writes it as (previous month's ending balance + base_budget). Adding
  // base_budget again here inflated Remaining Budget by a full month's budget.
  // See the header of db/schema.sql.
  const budgetCapacity = Number(balanceSnapshot?.starting_balance ?? 0);
  const spendingProgress = (budgetCapacity + totalIncome) > 0 ? Math.min(totalExpenses / (budgetCapacity + totalIncome), 1) : 0;
  const remainingBudget = budgetCapacity - totalExpenses + totalIncome;
  const accountNameById = Object.fromEntries(accounts.map((account) => [account.id, account.name]));

  // `day` comes from todayInAppTz(), which always returns 1-31, so this can
  // never divide by zero. The guard is against the value going missing some
  // other way and the month's entire spend being displayed as a daily figure.
  const dailyAverage = day > 0 ? totalExpenses / day : 0;

  // Savings rate, which the card labelled but never showed: the share of this
  // month's income that has not been spent. Undefined with no income, rather
  // than a division by zero rendered as NaN or Infinity.
  const savingsRate = totalIncome > 0 ? (totalIncome - totalExpenses) / totalIncome : null;

  // "Stable" was a hardcoded string. Compare this month's income with last
  // month's, from the same history the chart uses.
  const incomeTrend = useMemo(() => {
    const previous = monthlyTotals.find(
      (entry) => !(entry.year === year && entry.month === month)
        && (entry.year === (month === 1 ? year - 1 : year))
        && (entry.month === (month === 1 ? 12 : month - 1))
    );
    if (!previous) return 'Stable';
    // A 2% band, so ordinary variation does not read as a trend.
    const threshold = Math.max(previous.income * 0.02, 1);
    if (totalIncome > previous.income + threshold) return 'Up';
    if (totalIncome < previous.income - threshold) return 'Down';
    return 'Stable';
  }, [monthlyTotals, totalIncome, month, year]);

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

  // Only categories that actually appear this month, so the dropdown never
  // offers a filter that yields an empty table.
  const presentCategories = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.category))).sort(),
    [transactions]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="flex items-center justify-center h-screen">
          <p className="text-2xl text-slate-600">Loading your financial data...</p>
        </div>
      </main>
    );
  }

  // Only a failure to load the dashboard at all replaces the page. A failed
  // action — a delete that was rejected, say — used to blank the whole screen
  // and lose everything already on it; it now renders inline, below.
  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="flex items-center justify-center h-screen">
          <p className="text-2xl text-red-600">Error: {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between mb-8">
        <div className="flex flex-wrap gap-8 items-center text-slate-700">
          {/* Was a bare <span>: it looked like the active item in a nav that
              had no other destinations. Now a real link, marked current. */}
          <Link
            href="/"
            aria-current="page"
            className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-500"
          >
            Home
          </Link>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 hover:text-slate-900 transition"
          >
            Settings
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowTransactionModal(true)}
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-200/50 transition hover:bg-slate-800"
        >
          Add Transaction
        </button>
      </header>

      {pageError && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-3xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm text-red-700">{pageError}</p>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-sm font-semibold text-red-700 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 text-center">
          Today is {formattedDate}
        </h1>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Account Overview</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* "Link New Account" implied a bank connection. It opens a form
                where you type a name and a balance. */}
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Add Account
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-4 lg:grid-cols-3 md:grid-cols-2">
          {accounts.length === 0 ? (
            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
              <p className="text-slate-500">No accounts found. Add one to get started.</p>
            </div>
          ) : (
            accounts.map((account) => (
              <Card
                key={account.id}
                account={account}
                onUpdate={handleAccountUpdate}
                onDelete={handleAccountDelete}
              />
            ))
          )}

          <button
            type="button"
            onClick={() => setShowAccountModal(true)}
            className="flex min-h-44 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
          >
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">+</span>
            <span className="text-sm font-semibold">Add Account</span>
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr_1fr_1fr] mb-8 py-4">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg shadow-slate-200/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Total Monthly Spending</p>
              <p className="mt-4 text-4xl font-bold">{formatCurrency(totalExpenses)}</p>
            </div>
          </div>
          <SpendingChart className="mt-8" totals={monthlyTotals} />
          <p className="mt-6 text-sm text-slate-400">Daily average: {formatCurrency(dailyAverage)}</p>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Remaining Budget</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-4xl font-bold text-slate-900">{formatCurrency(remainingBudget)}</p>
              <p className="mt-3 text-sm text-slate-500">Budget + income - spending</p>
            </div>
            {/* Said "Updated" whenever a budget row existed, which told you
                nothing. The figure above is only trustworthy once the monthly
                job has written this month's snapshot; say which it is. */}
            {!monthlyBudget ? (
              <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">No budget</div>
            ) : balanceSnapshot ? (
              <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">Up to date</div>
            ) : (
              <div className="rounded-3xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">No carryover</div>
            )}
          </div>
          {monthlyBudget ? (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="text-sm text-slate-500">Spending progress</p>
                <p className="text-sm font-semibold text-slate-900">{Math.round(spendingProgress * 100)}%</p>
              </div>
              <ProgressBar percent={Math.round(spendingProgress * 100)} />
            </div>
          ) : (
            <div className="mt-6 rounded-3xl bg-slate-50 p-4 text-center text-sm text-slate-500">
              No budget data available
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Monthly Net Income</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-4xl font-bold text-slate-900">{formatCurrency(totalIncome)}</p>
              {/* Was the bare words "Savings rate" under the income figure,
                  with no rate anywhere. */}
              <p className="mt-3 text-sm text-slate-500">
                {savingsRate === null
                  ? 'Savings rate: no income yet'
                  : `Savings rate: ${Math.round(savingsRate * 100)}%`}
              </p>
            </div>
            <div
              className={`rounded-3xl px-4 py-3 text-sm font-semibold ${
                incomeTrend === 'Up'
                  ? 'bg-emerald-50 text-emerald-700'
                  : incomeTrend === 'Down'
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
              title="This month's income compared with last month's"
            >
              {incomeTrend}
            </div>
          </div>
          <div className="mt-6 rounded-3xl bg-slate-50 p-4 text-center text-sm text-slate-500">
            {monthlyBudget ? `${formatCurrency(monthlyBudget.base_budget)} base budget` : 'No budget data available'}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Spending Categories</p>
            <p className="text-sm font-semibold text-slate-900">{formatCurrency(totalExpenses)}</p>
          </div>
          <div className="mt-6 space-y-5">
            {sortedCategories.length === 0 ? (
              <p className="text-sm text-slate-500">No category spend data yet.</p>
            ) : (
              sortedCategories.map((entry) => (
                <div key={entry.category}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">{entry.category}</span>
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

      <section className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Transaction History</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Latest activity</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                filtersActive
                  ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {filtersActive ? `Filter (${filteredTransactions.length})` : 'Filter'}
            </button>
            <button
              type="button"
              onClick={() => setShowTransactionModal(true)}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-200/50 transition hover:bg-slate-800"
            >
              Add Transaction
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="filter-category" className="block text-sm font-medium text-slate-700 mb-1">
                Category
              </label>
              <select
                id="filter-category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-slate-500 focus:outline-none"
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
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-slate-500 focus:outline-none"
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
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="text-sm uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    {transactions.length === 0
                      ? 'No transactions this month.'
                      : 'No transactions match these filters.'}
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
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">{accountNameById[transaction.account_id] || 'Unknown'}</td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">{formatDate(transaction.date)}</td>
                  <td className={`bg-slate-50 px-4 py-4 text-right text-sm font-semibold ${isIncome(transaction.category) ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {isIncome(transaction.category) ? '+' : '-'}{formatCurrency(transaction.amount)}
                  </td>
                  <td className="bg-slate-50 px-4 py-4 text-right rounded-r-2xl">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        title="Edit transaction"
                        aria-label="Edit transaction"
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={() => setEditingTransaction(transaction)}
                      >
                        <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete transaction"
                        aria-label="Delete transaction"
                        className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        onClick={() => handleDeleteTransaction(transaction)}
                      >
                        <img src="/delete-black.svg" alt="Delete" className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showTransactionModal && (
        <AddTransactionModal
          accounts={accounts}
          onClose={() => setShowTransactionModal(false)}
          onCreate={(newTransaction) => {
            setTransactions((current) => [...current, newTransaction]);
            applyServerAccounts(newTransaction.accounts);
            setShowTransactionModal(false);
          }}
        />
      )}
      {editingTransaction && (
        <EditTransactionModal
          transaction={editingTransaction}
          accounts={accounts}
          onClose={() => setEditingTransaction(null)}
          onUpdate={handleSaveTransaction}
        />
      )}
      {showAccountModal && (
        <CreateAccountModal
          onClose={() => setShowAccountModal(false)}
          onCreate={(newAccount) => {
            setAccounts((current) => [...current, newAccount]);
            setShowAccountModal(false);
          }}
        />
      )}
      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
          accounts={accounts}
          onSaved={refresh}
        />
      )}
    </main>
  );
}
