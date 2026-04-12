"use client";

import React, { useEffect, useState } from 'react';
import Card from '../components/AccountCard';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  credit_limit?: number;
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
                <div key={account.id} className="flex-shrink-0">
                  <Card
                    name={account.name}
                    limit={account.credit_limit || 10000}
                    value={Math.abs(account.balance)}
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
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-blue-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Budget</p>
              <p className="text-3xl font-bold text-blue-600">
                {formatCurrency(monthlyBudget.base_budget)}
              </p>
            </div>
            <div className="bg-orange-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Spent</p>
              <p className="text-3xl font-bold text-orange-600">
                {formatCurrency(monthlyBudget.spent || 0)}
              </p>
            </div>
            <div className="bg-green-50 p-6 rounded-lg">
              <p className="text-gray-600 text-sm font-semibold mb-2">Remaining</p>
              <p className="text-3xl font-bold text-green-600">
                {formatCurrency(Math.max(0, monthlyBudget.base_budget - (monthlyBudget.spent || 0)))}
              </p>
            </div>
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
              {transactions.slice(0, 20).map((transaction) => (
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
                    <p className="text-lg font-bold text-red-600">
                      -{formatCurrency(transaction.amount)}
                    </p>
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