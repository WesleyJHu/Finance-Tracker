"use client";

import React, { useEffect, useState } from 'react';
import Card from '../components/AccountCard';

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

export default function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState<MonthlyBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get current month and year
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        // Fetch accounts
        const accountsRes = await fetch('/api/accounts');
        if (!accountsRes.ok) throw new Error('Failed to fetch accounts');
        const accountsData = await accountsRes.json();
        setAccounts(accountsData);

        // Fetch transactions for current month
        const transRes = await fetch(`/api/transactions?month=${month}&year=${year}`);
        if (!transRes.ok) throw new Error('Failed to fetch transactions');
        const transData = await transRes.json();
        setTransactions(transData);

        // Fetch monthly budget
        const budgetRes = await fetch(`/api/monthly_budgets?month=${month}`);
        if (!budgetRes.ok) throw new Error('Failed to fetch budget');
        const budgetData = await budgetRes.json();
        if (budgetData.length > 0) {
          setMonthlyBudget(budgetData[0]);
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

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const categoryTotals = transactions.reduce<Record<string, number>>((totals, transaction) => {
    if (transaction.category === 'Income') return totals; // Exclude income from category totals
    const category = transaction.category || 'Uncategorized';
    totals[category] = (totals[category] || 0) + transaction.amount;
    return totals;
  }, {});

  const totalExpenses = transactions.filter(t => t.category !== 'Income').reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = transactions.filter(t => t.category === 'Income').reduce((sum, t) => sum + t.amount, 0);

  const fixedCategories = ['grocery', 'food', 'technology', 'transportation', 'entertainment', 'bills', 'misc'];
  const categoryCards = fixedCategories.map(category => ({
    category,
    total: categoryTotals[category] || 0
  }));

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="flex items-center justify-center h-screen">
          <p className="text-2xl text-gray-600">Loading your financial data...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="flex items-center justify-center h-screen">
          <p className="text-2xl text-red-600">Error: {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Cards and Accounts Section */}
      <section className="bg-white border-b-2 border-gray-200 p-8">
        <h2 className="text-4xl font-bold mb-6 text-gray-800">Cards and Accounts</h2>
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100">
          <div className="flex gap-6 pb-4 min-w-min">
            {accounts.length === 0 ? (
              <p className="text-gray-500 text-lg">No accounts found. Add one to get started!</p>
            ) : (
              accounts.map((account) => (
                <div key={account.id} className="shrink-0">
                  <Card
                    id={account.id}
                    name={account.name}
                    type={account.type}
                    limit={account.max || 6500}
                    value={Math.abs(account.balance)}
                    onUpdate={(updated) =>
                      setAccounts((current) =>
                        current.map((item) =>
                          item.id === updated.id
                            ? {
                                ...item,
                                name: updated.name,
                                type: updated.type,
                                balance: updated.balance ?? item.balance,
                                max: updated.max ?? item.max,
                              }
                            : item
                        )
                      )
                    }
                    onDelete={(deletedId) =>
                      setAccounts((current) => current.filter((item) => item.id !== deletedId))
                    }
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Monthly Summary */}
      {monthlyBudget && (
        <section className="p-8 bg-white border-b-2 border-gray-200">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">Monthly Summary</h2>
          <div className="grid grid-cols-3 gap-6 mb-6">
            <div className="bg-green-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Budget Remaining</p>
              <p className="text-3xl font-bold text-green-600">
                {formatCurrency(monthlyBudget.base_budget - totalExpenses + totalIncome)}
              </p>
            </div>
            <div className="bg-orange-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Total Expenses</p>
              <p className="text-3xl font-bold text-orange-600">
                {formatCurrency(totalExpenses)}
              </p>
            </div>
            <div className="bg-blue-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Total Income</p>
              <p className="text-3xl font-bold text-blue-600">
                {formatCurrency(totalIncome)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {categoryCards.map(({ category, total }) => (
              <div key={category} className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
                <p className="text-sm text-gray-500 uppercase tracking-[0.15em] mb-2">{category}</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(total)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Transactions */}
      <section className="p-8 bg-white">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Recent Transactions</h2>
        <div className="overflow-y-auto">
          {transactions.length === 0 ? (
            <p className="text-gray-500 text-lg">No transactions this month</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex justify-between items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800">{transaction.description || transaction.category}</p>
                    <p className="text-sm text-gray-600">
                      {formatDate(transaction.date)}
                    </p>
                  </div>
                  <div className="text-right">
                    {transaction.category === 'Income' ? (
                      <p className="text-lg font-bold text-green-600">
                        +{formatCurrency(transaction.amount)}
                      </p>
                    ) : (
                      <p className="text-lg font-bold text-red-600">
                        -{formatCurrency(transaction.amount)}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">{transaction.category}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}