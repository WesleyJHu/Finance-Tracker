"use client";

import React, { useEffect, useState } from 'react';
import Card from '../components/AccountCard';
import CreateAccountModal from '../components/CreateAccountModal';
import AddTransactionModal from '../components/AddTransactionModal';
import EditTransactionModal from '../components/EditTransactionModal';
import SettingsModal from '../components/SettingsModal';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  max: number;
}

interface Transaction {
  id: string;
  date: string;
  amount: number;
  description?: string;
  category: string;
  account_id: string;
}

interface MonthlyBudget {
  id: string;
  month: number;
  year: number;
  base_budget: number;
  spent: number;
}

interface BalanceSnapshot {
  id: string;
  starting_balance: number;
  ending_balance: number | null;
  month: number;
  year: number;
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState<MonthlyBudget | null>(null);
  const [balanceSnapshot, setBalanceSnapshot] = useState<BalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(1);
  const [year, setYear] = useState(2024);

  const handleAccountUpdate = (updatedAccount: { id: string; name: string; type: string; balance: number; max?: number }) => {
    setAccounts(prev => prev.map(acc => acc.id === updatedAccount.id ? { ...acc, ...updatedAccount } : acc));
  };

  const handleAccountDelete = (id: string) => {
    setAccounts(prev => prev.filter(acc => acc.id !== id));
  };

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const getTransactionDelta = (transaction: Transaction) =>
    transaction.category.toLowerCase() === 'income' ? 0 : -transaction.amount;

  const isCreditAccountType = (type?: string) =>
    type?.toLowerCase().includes('credit');

  const getTransactionMaxDelta = (transaction: Transaction) =>
    transaction.category.toLowerCase() === 'income' ? transaction.amount : 0;

  const applyTransactionAccountChanges = (
    oldTransaction: Transaction | null,
    newTransaction: Transaction | null
  ) => {
    const oldDelta = oldTransaction ? getTransactionDelta(oldTransaction) : 0;
    const oldMaxDelta = oldTransaction ? getTransactionMaxDelta(oldTransaction) : 0;
    const newDelta = newTransaction ? getTransactionDelta(newTransaction) : 0;
    const newMaxDelta = newTransaction ? getTransactionMaxDelta(newTransaction) : 0;

    setAccounts((current) =>
      current.map((account) => {
        let updatedBalance = account.balance;
        let updatedMax = account.max;

        if (oldTransaction && account.id === oldTransaction.account_id) {
          updatedBalance -= oldDelta;
          if (!isCreditAccountType(account.type)) {
            updatedMax -= oldMaxDelta;
          }
        }

        if (newTransaction && account.id === newTransaction.account_id) {
          updatedBalance += newDelta;
          if (!isCreditAccountType(account.type)) {
            updatedMax += newMaxDelta;
          }
        }

        return {
          ...account,
          balance: updatedBalance,
          max: updatedMax,
        };
      })
    );
  };

  const handleDeleteTransaction = async (transaction: Transaction) => {
    try {
      const res = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: transaction.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || 'Failed to delete transaction');
      }

      setTransactions((current) => current.filter((t) => t.id !== transaction.id));
      applyTransactionAccountChanges(transaction, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete transaction');
      console.error('Delete transaction failed:', err);
    }
  };

  const handleSaveTransaction = (updatedTransaction: Transaction) => {
    if (!editingTransaction) return;

    setTransactions((current) =>
      current.map((transaction) =>
        transaction.id === updatedTransaction.id ? updatedTransaction : transaction
      )
    );

    applyTransactionAccountChanges(editingTransaction, updatedTransaction);
    setEditingTransaction(null);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(now);

        const month = Number(parts.find(p => p.type === "month")!.value);
        const year = Number(parts.find(p => p.type === "year")!.value);
        const day = Number(parts.find(p => p.type === "day")!.value);

        setMonth(month);
        setYear(year);
        setDay(day);

        const accountsRes = await fetch('/api/accounts');
        if (!accountsRes.ok) throw new Error('Failed to fetch accounts');
        const accountsData = await accountsRes.json();
        setAccounts(accountsData.map((account: Account) => ({
          ...account,
          balance: Number(account.balance),
          max: Number(account.max),
        })));

        const transRes = await fetch(`/api/transactions?month=${month}&year=${year}`);
        if (!transRes.ok) throw new Error('Failed to fetch transactions');
        const transData = await transRes.json();
        setTransactions(transData.map(normalizeTransaction));

        const budgetRes = await fetch(`/api/monthly_budgets?month=${month}`);
        if (!budgetRes.ok) throw new Error('Failed to fetch budget');
        const budgetData = await budgetRes.json();
        if (budgetData.length > 0) {
          setMonthlyBudget(budgetData[0]);
        }

        const snapshotRes = await fetch(`/api/balance_snapshot?month=${month}&year=${year}`);
        if (!snapshotRes.ok) {
          console.error('Failed to fetch balance snapshot', {
            status: snapshotRes.status,
            statusText: snapshotRes.statusText,
          });
          throw new Error('Failed to fetch balance snapshot');
        }
        const snapshotData = await snapshotRes.json();
        if (snapshotData.length > 0) {
          setBalanceSnapshot(snapshotData[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

    const formattedDate = new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);

    return date.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const normalizeTransaction = (transaction: any): Transaction => ({
    ...transaction,
    amount: Number(transaction.amount),
  });

  const totalExpenses = transactions
    .filter((t) => t.category.toLowerCase() !== 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = transactions
    .filter((t) => t.category.toLowerCase() === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const categoryTotals = transactions.reduce<Record<string, number>>((totals, transaction) => {
    if (transaction.category.toLowerCase() === 'income') return totals;
    const category = transaction.category || 'Uncategorized';
    totals[category] = (totals[category] || 0) + transaction.amount;
    return totals;
  }, {});

  const sortedCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));

  const maxCategoryAmount = sortedCategories.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  const budgetCapacity = Number(balanceSnapshot?.starting_balance ?? 0) + Number(monthlyBudget?.base_budget ?? 0);
  const spendingProgress = (budgetCapacity + totalIncome) > 0 ? Math.min(totalExpenses / (budgetCapacity + totalIncome), 1) : 0;
  const remainingBudget = budgetCapacity - totalExpenses + totalIncome;
  const accountNameById = Object.fromEntries(accounts.map((account) => [account.id, account.name]));

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="flex items-center justify-center h-screen">
          <p className="text-2xl text-slate-600">Loading your financial data...</p>
        </div>
      </main>
    );
  }

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
          <span className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-500">Home</span>

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

      <section className="mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 text-center">
          Today is {formattedDate}
        </h1>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Account Overview</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Link New Account
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
                id={account.id}
                name={account.name}
                type={account.type}
                value={account.balance}
                limit={account.max}
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
            <span className="text-sm font-semibold">Link New Account</span>
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
          <div className="mt-8 flex items-end gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className={`w-full rounded-xl bg-slate-800 ${index === 5 ? 'h-40' : index === 4 ? 'h-36' : index === 3 ? 'h-32' : index === 2 ? 'h-28' : index === 1 ? 'h-24' : 'h-20'}`}
              />
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-400">Daily average: {formatCurrency(totalExpenses / day)}</p>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Remaining Budget</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-4xl font-bold text-slate-900">{formatCurrency(remainingBudget)}</p>
              <p className="mt-3 text-sm text-slate-500">Budget + income - spending</p>
            </div>
            <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{monthlyBudget ? 'Updated' : 'No budget'}</div>
          </div>
          {monthlyBudget ? (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="text-sm text-slate-500">Spending progress</p>
                <p className="text-sm font-semibold text-slate-900">{Math.round(spendingProgress * 100)}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-linear-to-r from-sky-500 to-cyan-400"
                  style={{ width: `${Math.round(spendingProgress * 100)}%` }}
                />
              </div>
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
              <p className="mt-3 text-sm text-slate-500">Savings rate</p>
            </div>
            <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">Stable</div>
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
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-sky-500 to-cyan-400"
                      style={{ width: Math.round((entry.amount / maxCategoryAmount) * 100) + '%' }}
                    />
                  </div>
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
            <button className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Filter
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
              {transactions.map((transaction) => (
                <tr key={transaction.id} className="transition hover:bg-slate-100 border-b-8 border-white">
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-800 rounded-l-2xl">
                    <div className="flex items-center gap-2">
                      <img
                        src={`/${transaction.category.toLowerCase()}.svg`}
                        alt={transaction.category}
                        className="h-6 w-6"
                      />
                      <span>{transaction.description || transaction.category}</span>
                    </div>
                  </td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500 uppercase">{transaction.category}</td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">{accountNameById[transaction.account_id] || 'Unknown'}</td>
                  <td className="bg-slate-50 px-4 py-4 text-sm text-slate-500">{formatDate(transaction.date)}</td>
                  <td className={`bg-slate-50 px-4 py-4 text-right text-sm font-semibold ${transaction.category.toLowerCase() === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {transaction.category.toLowerCase() === 'income' ? '+' : '-'}{formatCurrency(transaction.amount)}
                  </td>
                  <td className="bg-slate-50 px-4 py-4 text-right rounded-r-2xl">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={() => setEditingTransaction(transaction)}
                      >
                        <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
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
            const normalizedTransaction = normalizeTransaction(newTransaction);
            console.debug('New transaction added:', normalizedTransaction);

            setTransactions((current) => [...current, normalizedTransaction]);
            applyTransactionAccountChanges(null, normalizedTransaction);
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
        />
      )}
    </main>
  );
}
