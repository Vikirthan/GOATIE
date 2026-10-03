import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { LoadingSpinner } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import { HerdSwitcher } from '@/components/common/HerdSwitcher';
import { MonthPicker } from '@/components/common/MonthPicker';
import {
  deleteOtherExpense,
  getFarmerGoats,
  getOtherExpenses,
  saveOtherExpense,
  updateOtherExpense,
} from '@/services/firebaseService';
import type { OtherExpense, OtherExpenseFieldKey } from '@/types';
import { EXPENSE_FIELDS, currentMonthKey, missingMonthKeys, monthKeyLabel, sumExpenseFields, toMonthKey } from '@/utils/expenses';
import { formatCurrency } from '@/utils/helpers';
import { format } from 'date-fns';

type FieldState = Record<OtherExpenseFieldKey, string>;

const emptyFields = (): FieldState => ({
  ilaiSelavu: '',
  kuthagai: '',
  medicineOthers: '',
  sambalam: '',
  petrol: '',
  teaFood: '',
  selavu: '',
});

const toFieldState = (e: OtherExpense): FieldState => ({
  ilaiSelavu: String(e.ilaiSelavu ?? ''),
  kuthagai: String(e.kuthagai ?? ''),
  medicineOthers: String(e.medicineOthers ?? ''),
  sambalam: String(e.sambalam ?? ''),
  petrol: String(e.petrol ?? ''),
  teaFood: String(e.teaFood ?? ''),
  selavu: String(e.selavu ?? ''),
});

export const OtherExpensesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, activeHerdId, viewingHerdId, isWritable, readOnlyView } = useAuth();
  const [expenses, setExpenses] = useState<OtherExpense[]>([]);
  const [pendingMonths, setPendingMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [fields, setFields] = useState<FieldState>(emptyFields());
  const [editingId, setEditingId] = useState<string | null>(null);

  const targetHerdId = viewingHerdId ?? activeHerdId ?? user?.id ?? null;
  const canWrite = targetHerdId ? isWritable(targetHerdId) : false;

  const liveTotal = useMemo(() => sumExpenseFields(fields), [fields]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [all, goats] = await Promise.all([
        getOtherExpenses(user.id),
        getFarmerGoats(user.id).catch(() => []),
      ]);
      const scoped = viewingHerdId ? all.filter((e) => e.farmerId === viewingHerdId) : all;
      scoped.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      setExpenses(scoped);

      // Pending backfill: every month since the herd's first purchase that
      // still has no entry, so months can be filled in from the book.
      const scopedGoats = viewingHerdId ? goats.filter((g) => g.farmerId === viewingHerdId) : goats;
      const first = scopedGoats
        .map((g) => new Date(g.purchaseDate).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => a - b)[0];
      if (first !== undefined) {
        const existing = new Set(scoped.map((e) => e.monthKey));
        setPendingMonths(missingMonthKeys(toMonthKey(new Date(first)), currentMonthKey(), existing));
      } else {
        setPendingMonths([]);
      }
    } catch (err: any) {
      showToast('error', 'Failed to load expenses', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener('data-synced', reload);
    return () => window.removeEventListener('data-synced', reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, viewingHerdId]);

  const resetForm = () => {
    setFields(emptyFields());
    setEditingId(null);
    setMonthKey(currentMonthKey());
  };

  const handleFillMonth = (key: string) => {
    if (!canWrite) {
      showToast('error', 'View-only herd', 'You can look at this herd but cannot record into it.');
      return;
    }
    setEditingId(null);
    setFields(emptyFields());
    setMonthKey(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !targetHerdId) return;
    if (!canWrite) {
      showToast('error', 'View-only herd', 'You can look at this herd but cannot record into it.');
      return;
    }
    if (!monthKey) {
      showToast('error', 'Pick a month', 'Choose the month these expenses belong to.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const editing = expenses.find((x) => x.id === editingId);
        // Month switch onto an occupied month is a loud duplicate.
        if (editing && editing.monthKey !== monthKey && expenses.some((x) => x.monthKey === monthKey)) {
          showToast('error', `Entry for ${monthKeyLabel(monthKey)} already exists!`, 'Only one Other Expenses entry is allowed per month — delete the existing entry first.');
          setSaving(false);
          return;
        }
        await updateOtherExpense(editingId, fields);
        showToast('success', `Expenses for ${monthKeyLabel(monthKey)} updated`, `Month total ${formatCurrency(sumExpenseFields(fields), 'INR')}`);
      } else {
        await saveOtherExpense(targetHerdId, monthKey, fields);
        showToast('success', `Expenses for ${monthKeyLabel(monthKey)} saved`, `Month total ${formatCurrency(sumExpenseFields(fields), 'INR')}`);
      }
      resetForm();
      await load();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('already exists!')) {
        // Loud duplicate-month failure, as requested.
        showToast('error', `Entry for ${monthKeyLabel(monthKey)} already exists!`, 'Only one Other Expenses entry is allowed per month — edit or delete the existing entry instead.');
      } else {
        showToast('error', 'Failed to save expenses', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (expense: OtherExpense) => {
    if (!canWrite) {
      showToast('error', 'View-only herd', 'You can look at this herd but cannot record into it.');
      return;
    }
    setEditingId(expense.id);
    setMonthKey(expense.monthKey);
    setFields(toFieldState(expense));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (expense: OtherExpense) => {
    if (!canWrite) {
      showToast('error', 'View-only herd', 'You can look at this herd but cannot record into it.');
      return;
    }
    if (!window.confirm(`Delete Other Expenses for ${monthKeyLabel(expense.monthKey)}? This cannot be undone.`)) return;
    try {
      await deleteOtherExpense(expense.id);
      showToast('success', 'Entry deleted');
      if (editingId === expense.id) resetForm();
      await load();
    } catch (err: any) {
      showToast('error', 'Failed to delete entry', err?.message);
    }
  };

  if (!user) return <LoadingSpinner message="Loading expenses..." />;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Other Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monthly costs beyond goat purchase — one entry per month</p>
        </div>
        <HerdSwitcher />
      </div>

      {readOnlyView && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          Viewing another herd — read-only. Recording expenses is disabled here.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-emerald-500" />
                {editingId ? 'Edit month entry' : 'New month entry'}
              </CardTitle>
              <CardDescription>Pick the month on top, fill the 7 fields, the total adds up automatically.</CardDescription>
            </div>
            {editingId && (
              <Button variant="outline" size="sm" onClick={resetForm}>
                Cancel edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="expense-month">Month</Label>
              <MonthPicker
                id="expense-month"
                value={monthKey}
                onChange={setMonthKey}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {EXPENSE_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <Label htmlFor={`expense-${key}`}>{label}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground pointer-events-none">₹</span>
                    <Input
                      id={`expense-${key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="pl-7"
                      value={fields[key]}
                      onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-muted/60 border border-border px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">Total for {monthKey ? monthKeyLabel(monthKey) : '—'}</span>
              <span className="text-xl font-bold">{formatCurrency(liveTotal, 'INR')}</span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="primary" type="submit" isLoading={saving} disabled={!canWrite}>
                <Plus className="h-4 w-4 mr-1" />
                {editingId ? 'Update entry' : 'Save month entry'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending months</CardTitle>
          <CardDescription>
            {pendingMonths.length === 0
              ? 'Every month since your first purchase has an entry.'
              : `${pendingMonths.length} month(s) since your first purchase still need entries — fill them from your book.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-2 text-sm text-muted-foreground">Checking months…</p>
          ) : pendingMonths.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">All caught up! No pending months.</p>
          ) : (
            <ul className="space-y-2">
              {pendingMonths.map((key) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border p-3"
                >
                  <div>
                    <p className="font-semibold">{monthKeyLabel(key)}</p>
                    <p className="text-xs text-muted-foreground">No entry yet — fill from your book</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleFillMonth(key)} disabled={!canWrite}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Fill entry
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Month logs</CardTitle>
          <CardDescription>{expenses.length} month(s) recorded · newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner message="Loading month logs..." />
          ) : expenses.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No expense entries yet — save your first month above.</p>
          ) : (
            <ul className="space-y-3">
              {expenses.map((expense) => (
                <li key={expense.id} className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="font-semibold">{monthKeyLabel(expense.monthKey)}</p>
                      <p className="text-xs text-muted-foreground">
                        Entered {format(new Date(expense.createdAt), 'dd/MM/yyyy')}
                      </p>
                    </div>
                    <p className="text-lg font-bold">{formatCurrency(expense.total, 'INR')}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPENSE_FIELDS.map(({ key, label }) => (
                      <span key={key} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-semibold">₹{Number(expense[key] || 0).toLocaleString('en-IN')}</span>
                      </span>
                    ))}
                  </div>
                  {canWrite && (
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => handleEdit(expense)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void handleDelete(expense)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
