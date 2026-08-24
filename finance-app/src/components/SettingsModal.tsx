"use client";

import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { formatCurrency } from '@/lib/format';
import { CATEGORIES, displayCategory } from '@/lib/categories';
import type { Account, MonthlyBudget, RecurringPayment } from '@/types/api';

interface SettingsModalProps {
  onClose: () => void;
  accounts: Account[];
  /**
   * Called after a change that the dashboard displays. Budget edits used to
   * stay invisible on the dashboard until a full page reload.
   */
  onSaved?: () => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const EMPTY_RECURRING = {
  amount: '',
  day_of_month: '',
  description: '',
  account_id: '',
  category: ''
};

export default function SettingsModal({ onClose, accounts, onSaved }: SettingsModalProps) {
  const [budgets, setBudgets] = useState<MonthlyBudget[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringPayment | null>(null);

  // Replaces alert(): seven blocking dialogs that stopped the page, lost the
  // user's place, and could not be styled or dismissed by keyboard the way the
  // rest of the app can. Errors now render where the action was taken.
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Replaces confirm() for deletion, matching the inline confirmation
  // EditAccountModal uses for archiving.
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const [newRecurring, setNewRecurring] = useState(EMPTY_RECURRING);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const [budgetsRes, recurringRes] = await Promise.all([
          fetch('/api/monthly_budgets'),
          fetch('/api/recurring_payments')
        ]);

        if (!budgetsRes.ok || !recurringRes.ok) {
          throw new Error('Could not load settings');
        }

        setBudgets(await budgetsRes.json());
        setRecurringPayments(await recurringRes.json());
      } catch (error) {
        console.error('Error fetching settings data:', error);
        setLoadError(error instanceof Error ? error.message : 'Could not load settings');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleBudgetChange = (month: number, base_budget: string) => {
    setBudgetSaved(false);
    setBudgets(prev => {
      const parsed = Number(base_budget) || 0;
      // The grid renders all 12 months whether or not a row exists, so a month
      // the database has never seen has nothing to map over. Add it here and
      // let the upsert create it on save.
      return prev.some(b => b.month === month)
        ? prev.map(b => (b.month === month ? { ...b, base_budget: parsed } : b))
        : [...prev, { month, base_budget: parsed } as MonthlyBudget];
    });
  };

  const handleSaveBudgets = async () => {
    setSaving(true);
    setBudgetError(null);
    setBudgetSaved(false);
    try {
      const responses = await Promise.all(
        budgets.map(budget =>
          fetch('/api/monthly_budgets', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month: budget.month, base_budget: budget.base_budget })
          })
        )
      );

      // Nothing checked res.ok before, so a rejected save looked identical to a
      // successful one until the next page load put the old number back.
      const failed = responses.filter(res => !res.ok);
      if (failed.length > 0) {
        throw new Error(
          failed.length === 1
            ? 'One month could not be saved.'
            : `${failed.length} months could not be saved.`
        );
      }

      setBudgetSaved(true);
      // Re-reads from the database, so a PATCH that silently failed shows the
      // old value on the dashboard rather than the value we hoped for.
      onSaved?.();
    } catch (error) {
      console.error('Error saving budgets:', error);
      setBudgetError(error instanceof Error ? error.message : 'Error saving budgets');
    } finally {
      setSaving(false);
    }
  };

  const submitRecurring = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecurringError(null);

    const editing = editingRecurring;
    try {
      const res = await fetch('/api/recurring_payments', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { id: editing.id } : {}),
          ...newRecurring,
          amount: Number(newRecurring.amount),
          day_of_month: Number(newRecurring.day_of_month)
        })
      });

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || `Error ${editing ? 'updating' : 'adding'} recurring payment`);
      }

      const data = await res.json();
      setRecurringPayments(prev =>
        editing ? prev.map(r => (r.id === data.id ? data : r)) : [...prev, data]
      );
      setEditingRecurring(null);
      setShowAddRecurring(false);
      setNewRecurring(EMPTY_RECURRING);
    } catch (error) {
      console.error('Recurring payment save failed:', error);
      setRecurringError(error instanceof Error ? error.message : 'Error saving recurring payment');
    }
  };

  const handleDeleteRecurring = async (id: number) => {
    setRecurringError(null);
    try {
      const res = await fetch(`/api/recurring_payments?id=${id}`, { method: 'DELETE' });

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || 'Error deleting recurring payment');
      }

      setRecurringPayments(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Error deleting recurring payment:', error);
      setRecurringError(error instanceof Error ? error.message : 'Error deleting recurring payment');
    } finally {
      setConfirmingDelete(null);
    }
  };

  const startEditRecurring = (payment: RecurringPayment) => {
    setRecurringError(null);
    setEditingRecurring(payment);
    setNewRecurring({
      amount: payment.amount.toString(),
      day_of_month: payment.day_of_month.toString(),
      description: payment.description || '',
      account_id: payment.account_id ?? '',
      category: payment.category
    });
  };

  const cancelRecurring = () => {
    setShowAddRecurring(false);
    setEditingRecurring(null);
    setRecurringError(null);
    setNewRecurring(EMPTY_RECURRING);
  };

  if (loading) {
    return (
      <Modal onClose={onClose} size="settings">
        <p>Loading settings...</p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="settings">
        {/* Bespoke header: centred, no description, and a "x" close control
            rather than the "Close" label the other five modals use. */}
        <div className="flex items-center justify-between mb-6 max-md:mb-4">
          <h2 className="text-2xl font-bold text-slate-900 max-md:text-xl">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-slate-500 hover:text-slate-700 text-2xl max-md:inline-flex max-md:items-center max-md:justify-center max-md:min-h-11 max-md:min-w-11"
          >
            ×
          </button>
        </div>

        {loadError && (
          <p className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
          </p>
        )}

        {/* Monthly Budgets Section */}
        <section className="mb-8">
          <h3 className="text-xl font-semibold text-slate-900 mb-4 max-md:text-lg">Monthly Budgets</h3>
          {/* Two columns on a phone: twelve stacked cards was ~1300px of
              scroll before the recurring-payments section came into view. */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-md:grid-cols-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
              const budget = budgets.find(b => b.month === month);
              return (
                <div key={month} className="p-4 border border-slate-200 rounded-lg max-md:p-3">
                  <label
                    htmlFor={`budget-month-${month}`}
                    className="block text-sm font-medium text-slate-700 mb-2 max-md:mb-1"
                  >
                    {monthNames[month - 1]}
                  </label>
                  <input
                    id={`budget-month-${month}`}
                    type="number"
                    step="0.01"
                    value={budget?.base_budget ?? 0}
                    onChange={(e) => handleBudgetChange(month, e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 max-md:px-2 max-md:min-h-11"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 max-md:flex-col max-md:items-stretch">
            <button
              onClick={handleSaveBudgets}
              disabled={saving}
              className="px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 max-md:w-full max-md:min-h-11"
            >
              {saving ? 'Saving...' : 'Save Budgets'}
            </button>
            {budgetSaved && <p className="text-sm text-emerald-600">Budgets saved.</p>}
            {budgetError && <p className="text-sm text-red-600">{budgetError}</p>}
          </div>
        </section>

        {/* Recurring Payments Section */}
        <section>
          <div className="flex items-center justify-between mb-4 max-md:flex-col max-md:items-start max-md:gap-3">
            <h3 className="text-xl font-semibold text-slate-900 max-md:text-lg">Recurring Payments</h3>
            <button
              onClick={() => {
                setRecurringError(null);
                setShowAddRecurring(true);
              }}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 max-md:w-full max-md:min-h-11"
            >
              Add Recurring Payment
            </button>
          </div>

          {recurringError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {recurringError}
            </p>
          )}

          <div className="space-y-4">
            {recurringPayments.map(payment => (
              <div key={payment.id} className="p-4 border border-slate-200 rounded-lg max-md:p-3">
                <div className="flex items-center justify-between max-md:flex-col max-md:items-start max-md:gap-3">
                  <div>
                    <p className="font-medium">{payment.description || payment.category}</p>
                    <p className="text-sm text-slate-500">
                      {formatCurrency(payment.amount)} on the {payment.day_of_month} of every month
                    </p>
                    <p className="text-sm text-slate-500">
                      Account: {accounts.find(a => a.id === payment.account_id)?.name || 'Unknown'}
                    </p>
                  </div>
                  <div className="flex gap-2 max-md:w-full">
                    <button
                      onClick={() => startEditRecurring(payment)}
                      title="Edit recurring payment"
                      aria-label="Edit recurring payment"
                      className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 max-md:flex-1 max-md:min-h-11 max-md:inline-flex max-md:items-center max-md:justify-center max-md:gap-2"
                    >
                      <img src="/edit.svg" alt="Edit" className="h-4 w-4" />
                      <span className="md:hidden">Edit</span>
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(payment.id)}
                      title="Delete recurring payment"
                      aria-label="Delete recurring payment"
                      className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 max-md:flex-1 max-md:min-h-11 max-md:inline-flex max-md:items-center max-md:justify-center max-md:gap-2"
                    >
                      <img src="/delete-black.svg" alt="Delete" className="h-4 w-4" />
                      <span className="md:hidden">Delete</span>
                    </button>
                  </div>
                </div>

                {confirmingDelete === payment.id && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-700">
                      Delete this recurring payment? Transactions it has already
                      created stay in your history.
                    </p>
                    <div className="mt-3 flex gap-3 max-md:flex-col">
                      <button
                        type="button"
                        onClick={() => handleDeleteRecurring(payment.id)}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 max-md:min-h-11"
                      >
                        Delete payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 max-md:min-h-11"
                      >
                        Keep payment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(showAddRecurring || editingRecurring) && (
            /* A real <form>, so the `required` attributes on these five fields
               actually block submission. They were inert while the submit
               button was a bare onClick handler outside any form. */
            <form onSubmit={submitRecurring} className="mt-6 p-4 border border-slate-200 rounded-lg max-md:p-3">
              <h4 className="text-lg font-medium mb-4">
                {editingRecurring ? 'Edit Recurring Payment' : 'Add Recurring Payment'}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="recurring-amount" className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                  <input
                    id="recurring-amount"
                    type="number"
                    step="0.01"
                    required
                    value={newRecurring.amount}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="recurring-day" className="block text-sm font-medium text-slate-700 mb-1">Day of Month</label>
                  <input
                    id="recurring-day"
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
                  <label htmlFor="recurring-account" className="block text-sm font-medium text-slate-700 mb-1">Account</label>
                  <select
                    id="recurring-account"
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
                  <label htmlFor="recurring-category" className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    id="recurring-category"
                    required
                    value={newRecurring.category}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  >
                    <option value="">Select Category</option>
                    {/* recurring_payments.category stores Title Case, unlike
                        transactions.category. The job lowercases it on the way
                        into a transaction. See lib/categories.ts. */}
                    {CATEGORIES.map(category => (
                      <option key={category} value={displayCategory(category)}>
                        {displayCategory(category)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="recurring-description" className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    id="recurring-description"
                    type="text"
                    required
                    value={newRecurring.description}
                    onChange={(e) => setNewRecurring(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4 max-md:flex-col">
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 max-md:w-full max-md:min-h-11"
                >
                  {editingRecurring ? 'Update' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={cancelRecurring}
                  className="px-4 py-2 bg-slate-300 text-slate-700 rounded-lg hover:bg-slate-400 max-md:w-full max-md:min-h-11"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
    </Modal>
  );
}
