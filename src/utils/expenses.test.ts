import { describe, expect, it } from 'vitest';
import {
  EXPENSE_FIELDS,
  currentMonthKey,
  duplicateMonthError,
  missingMonthKeys,
  monthKeyLabel,
  monthKeyToDate,
  sumExpenseFields,
  sumOtherExpenses,
  toMonthKey,
} from '@/utils/expenses';

describe('EXPENSE_FIELDS', () => {
  it('keeps the 7 requested Tamil labels as-is', () => {
    expect(EXPENSE_FIELDS.map((f) => f.label)).toEqual([
      'இவை செலவு',
      'குத்தகை',
      'Medicine & Others',
      'சம்பளம்',
      'பெட்ரோல்',
      'டி & சாப்பாடு',
      'செலவு',
    ]);
  });
});

describe('month helpers', () => {
  it('round-trips month keys', () => {
    expect(toMonthKey(new Date(2026, 8, 15))).toBe('2026-09');
    expect(monthKeyToDate('2026-09').getMonth()).toBe(8);
    expect(monthKeyLabel('2026-09')).toContain('2026');
  });

  it('defaults to the current month', () => {
    expect(currentMonthKey()).toBe(toMonthKey(new Date()));
  });
});

describe('sumExpenseFields', () => {
  it('adds the 7 fields and ignores blanks/negatives', () => {
    expect(
      sumExpenseFields({
        ilaiSelavu: '100',
        kuthagai: 200,
        medicineOthers: '',
        sambalam: '50.5',
        petrol: '-10',
        teaFood: 0,
        selavu: '49.5',
      }),
    ).toBe(400);
  });
});

describe('sumOtherExpenses', () => {
  const months = [
    { expenseDate: new Date(2026, 7, 1), total: 100 },
    { expenseDate: new Date(2026, 8, 1), total: 200 },
  ];

  it('sums all months without a window', () => {
    expect(sumOtherExpenses(months)).toBe(300);
  });

  it('respects the From/To date filter', () => {
    expect(sumOtherExpenses(months, new Date(2026, 8, 1), null)).toBe(200);
    expect(sumOtherExpenses(months, null, new Date(2026, 7, 31))).toBe(100);
  });
});

describe('duplicateMonthError', () => {
  it('fails loudly naming the month', () => {
    const err = duplicateMonthError('2026-09');
    expect(err.message).toContain('already exists!');
    expect(err.message).toContain('one Other Expenses entry');
  });
});

describe('missingMonthKeys', () => {
  it('lists months without entries, newest first', () => {
    expect(missingMonthKeys('2026-07', '2026-09', new Set(['2026-08']))).toEqual([
      '2026-09',
      '2026-07',
    ]);
  });

  it('returns empty when every month is filled', () => {
    expect(
      missingMonthKeys('2026-09', '2026-09', new Set(['2026-09'])),
    ).toEqual([]);
  });

  it('crosses year boundaries and rejects bad ranges', () => {
    expect(missingMonthKeys('2025-12', '2026-01', new Set())).toEqual([
      '2026-01',
      '2025-12',
    ]);
    expect(missingMonthKeys('2026-09', '2026-07', new Set())).toEqual([]);
    expect(missingMonthKeys('oops', '2026-07', new Set())).toEqual([]);
  });
});
