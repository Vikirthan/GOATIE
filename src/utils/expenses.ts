import type { OtherExpense, OtherExpenseFieldKey } from '@/types';

/** The 7 expense fields, labels kept exactly as requested (Tamil as-is). */
export const EXPENSE_FIELDS: { key: OtherExpenseFieldKey; label: string }[] = [
  { key: 'ilaiSelavu', label: 'இவை செலவு' },
  { key: 'kuthagai', label: 'குத்தகை' },
  { key: 'medicineOthers', label: 'Medicine & Others' },
  { key: 'sambalam', label: 'சம்பளம்' },
  { key: 'petrol', label: 'பெட்ரோல்' },
  { key: 'teaFood', label: 'டி & சாப்பாடு' },
  { key: 'selavu', label: 'செலவு' },
];

/** 'YYYY-MM' for a Date (local calendar month). */
export function toMonthKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** First day of the month for a 'YYYY-MM' key. */
export function monthKeyToDate(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1);
}

/** Display label for a month key, e.g. 'Sep 2026'. */
export function monthKeyLabel(monthKey: string): string {
  return monthKeyToDate(monthKey).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

/** Current month key for the month picker default. */
export function currentMonthKey(now = new Date()): string {
  return toMonthKey(now);
}

export function sumExpenseFields(values: Record<OtherExpenseFieldKey, number | string>): number {
  let total = 0;
  for (const { key } of EXPENSE_FIELDS) {
    const n = typeof values[key] === 'number' ? (values[key] as number) : parseFloat(String(values[key] ?? ''));
    total += isNaN(n) || n < 0 ? 0 : n;
  }
  return Math.round(total * 100) / 100;
}

export function expenseTotal(e: Pick<OtherExpense, OtherExpenseFieldKey>): number {
  return sumExpenseFields(e as Record<OtherExpenseFieldKey, number>);
}

/** Sum of monthly totals, optionally restricted to an inclusive date window. */
export function sumOtherExpenses(
  expenses: Pick<OtherExpense, 'expenseDate' | 'total'>[],
  from?: Date | null,
  to?: Date | null,
): number {
  const fromT = from ? new Date(from).getTime() : null;
  const toD = to ? new Date(to) : null;
  if (toD) toD.setHours(23, 59, 59, 999);
  const toT = toD ? toD.getTime() : null;
  let sum = 0;
  for (const e of expenses) {
    const t = new Date(e.expenseDate).getTime();
    if (fromT !== null && t < fromT) continue;
    if (toT !== null && t > toT) continue;
    const n = typeof e.total === 'number' ? e.total : parseFloat(String(e.total ?? ''));
    sum += isNaN(n) ? 0 : n;
  }
  return Math.round(sum * 100) / 100;
}

/** Loud duplicate-month error (surfaced via toast by callers). */
export function duplicateMonthError(monthKey: string): Error {
  return new Error(
    `Entry for ${monthKeyLabel(monthKey)} already exists! Only one Other Expenses entry is allowed per month — edit or delete the existing entry instead.`,
  );
}

/**
 * Months from startKey to endKey (inclusive) with no entry yet, newest first.
 * Used for the "pending" backfill log so months can be filled from the book.
 */
export function missingMonthKeys(startKey: string, endKey: string, existing: Set<string>): string[] {
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!valid.test(startKey) || !valid.test(endKey) || startKey > endKey) return [];
  const out: string[] = [];
  let [y, m] = endKey.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` >= startKey) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!existing.has(key)) out.push(key);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
