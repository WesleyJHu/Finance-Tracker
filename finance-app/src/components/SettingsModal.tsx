"use client";

import React, { useEffect, useState } from 'react';

interface MonthlyBudget {
  id: string;
  month: number;
  year: number;
  base_budget: number;
  spent: number;
}

interface RecurringPayment {
  id: string;
  amount: number;
  day_of_month: number;
  description?: string;
  account_id: string;
  category: string;
}

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  max: number;
}

interface SettingsModalProps {
  onClose: () => void;
  accounts: Account[];
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const categories = [
  "Income",
  "Grocery",
  "Food",
  "Tech",
  "Transportation",
  "Entertainment",
  "Bills",
  "Misc",
];

export default function SettingsModal({ onClose, accounts }: SettingsModalProps) {
  const [budgets, setBudgets] = useState<MonthlyBudget[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringPayment | null>(null);

  const [newRecurring, setNewRecurring] = useState({
    amount: '',
    day_of_month: '',
    description: '',
    account_id: '',
    category: ''
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const [budgetsRes, recurringRes] = await Promise.all([
          fetch('/api/monthly_budgets'),
          fetch('/api/recurring_payments')
        ]);

        if (budgetsRes.ok) {
          const budgetsData = await budgetsRes.json();
          setBudgets(budgetsData);
        }

        if (recurringRes.ok) {
          const recurringData = await recurringRes.json();
          setRecurringPayments(recurringData);
        }
      } catch (error) {
        console.error('Error fetching settings data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleBudgetChange = (month: number, base_budget: string) => {
    setBudgets(prev => prev.map(b =>
      b.month === month ? { ...b, base_budget: Number(base_budget) || 0 } : b
    ));
  };

  const handleSaveBudgets = async () => {
    setSaving(true);
    try {
      const promises = budgets.map(budget =>
        fetch('/api/monthly_budgets', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: budget.month, base_budget: budget.base_budget })
        })
      );

      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving budgets:', error);
      alert('Error saving budgets');
    } finally {
      setSaving(false);
    }
  };

  const handleAddRecurring = async () => {
    try {
      const res = await fetch('/api/recurring_payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newRecurring,
          amount: Number(newRecurring.amount),
          day_of_month: Number(newRecurring.day_of_month)
        })
      });

      if (res.ok) {
        const data = await res.json();
        setRecurringPayments(prev => [...prev, data]);
        setNewRecurring({
          amount: '',
          day_of_month: '',
          description: '',
          account_id: '',
          category: ''
        });
        setShowAddRecurring(false);
      } else {
        const error = await res.json();
        alert(error.error || 'Error adding recurring payment');
      }
    } catch (error) {
      console.error('Error adding recurring payment:', error);
      alert('Error adding recurring payment');
    }
  };

  const handleUpdateRecurring = async () => {
    if (!editingRecurring) return;

    try {
      const res = await fetch('/api/recurring_payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRecurring.id,
          ...newRecurring,
          amount: Number(newRecurring.amount),
          day_of_month: Number(newRecurring.day_of_month)
        })
      });

      if (res.ok) {
        const data = await res.json();
        setRecurringPayments(prev => prev.map(r => r.id === data.id ? data : r));
        setEditingRecurring(null);
        setNewRecurring({
          amount: '',
          day_of_month: '',
          description: '',
          account_id: '',
          category: ''
        });
      } else {
        const error = await res.json();
        alert(error.error || 'Error updating recurring payment');
      }
    } catch (error) {
      console.error('Error updating recurring payment:', error);
      alert('Error updating recurring payment');
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recurring payment?')) return;

    try {
      const res = await fetch(`/api/recurring_payments?id=${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setRecurringPayments(prev => prev.filter(r => r.id !== id));
      } else {
        const error = await res.json();
        alert(error.error || 'Error deleting recurring payment');
      }
    } catch (error) {
      console.error('Error deleting recurring payment:', error);
      alert('Error deleting recurring payment');
    }
  };

  const startEditRecurring = (payment: RecurringPayment) => {
    setEditingRecurring(payment);
    setNewRecurring({
      amount: payment.amount.toString(),
      day_of_month: payment.day_of_month.toString(),
      description: payment.description || '',
      account_id: payment.account_id,
      category: payment.category
    });
  };

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white p-8 rounded-3xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white p-8 rounded-3xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Monthly Budgets Section */}
        <section className="mb-8">
          <h3 className="text-xl font-semibold text-slate-900 mb-4">Monthly Budgets</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
              const budget = budgets.find(b => b.month === month);
              return (
                <div key={month} className="p-4 border border-slate-200 rounded-lg">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {monthNames[month - 1]}
                  </label>
                  <input
                    type="number"
                    step="1.00"
                    value={budget?.base_budget || 0}
                    onChange={(e) => handleBudgetChange(month, e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              );
            })}
          </div>
          <button
            onClick={handleSaveBudgets}
            disabled={saving}
            className="mt-4 px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Budgets'}
          </button>
        </section>

        {/* Recurring Payments Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-slate-900">Recurring Payments</h3>
            <button
              onClick={() => setShowAddRecurring(true)}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              Add Recurring Payment
            </button>
          </div>

          <div className="space-y-4">
            {recurringPayments.map(payment => (
              <div key={payment.id} className="p-4 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-medium">{payment.description || payment.category}</p>
                  <p className="text-sm text-slate-500">
                    {formatCurrency(payment.amount)} on the {payment.day_of_month} of every month
                  </p>
                  <p className="text-sm text-slate-500">
                    Account: {accounts.find(a => a.id === payment.account_id)?.name || 'Unknown'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEditRecurring(payment)}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteRecurring(payment.id)}
                    className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    <img src="/delete-black.svg" alt="Delete" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {(showAddRecurring || editingRecurring) && (
            <div className="mt-6 p-4 border border-slate-200 rounded-lg">
              <h4 className="text-lg font-medium mb-4">
                {editingRecurring ? 'Edit Recurring Payment' : 'Add Recurring Payment'}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                  <input
                    type="number"
                    step="1.00"
                    required
                    value={newRecurring.amount}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Day of Month</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={newRecurring.day_of_month}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, day_of_month: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account</label>
                  <select
                    required
                    value={newRecurring.account_id}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, account_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  >
                    <option value="">Select Account</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    required
                    value={newRecurring.category}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  >
                    <option value="">Select Category</option>
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    required
                    value={newRecurring.description}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={editingRecurring ? handleUpdateRecurring : handleAddRecurring}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  {editingRecurring ? 'Update' : 'Add'}
                </button>
                <button
                  onClick={() => {
                    setShowAddRecurring(false);
                    setEditingRecurring(null);
                    setNewRecurring({
                      amount: '',
                      day_of_month: '',
                      description: '',
                      account_id: '',
                      category: ''
                    });
                  }}
                  className="px-4 py-2 bg-slate-300 text-slate-700 rounded-lg hover:bg-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}