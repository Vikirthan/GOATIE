import { describe, expect, it, vi } from 'vitest';

// The converters live in supabaseService; mock the client so importing the
// module never touches a real backend (nor throws on empty env).
vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

import {
  camelToSnake,
  mapExpenseData,
  mapGoatData,
  parseDates,
  snakeToCamel,
} from '@/services/supabaseService';

describe('camelToSnake', () => {
  it('converts keys and recurses into nested objects and arrays', () => {
    expect(
      camelToSnake({ farmerId: 'x', saleInfo: { saleDate: 'd' }, tags: [{ earTagNumber: '1' }] }),
    ).toEqual({ farmer_id: 'x', sale_info: { sale_date: 'd' }, tags: [{ ear_tag_number: '1' }] });
  });

  it('passes Date instances through untouched', () => {
    const d = new Date('2026-01-01');
    expect(camelToSnake({ purchaseDate: d }).purchase_date).toBe(d);
    expect(camelToSnake(d)).toBe(d);
  });

  it('leaves primitives and null alone', () => {
    expect(camelToSnake(null)).toBeNull();
    expect(camelToSnake(5)).toBe(5);
    expect(camelToSnake('RKT')).toBe('RKT');
  });
});

describe('snakeToCamel', () => {
  it('converts keys back, including multi-underscore names', () => {
    expect(snakeToCamel({ farmer_id: 'x', purchase_price_per_kg: 3 })).toEqual({
      farmerId: 'x',
      purchasePricePerKg: 3,
    });
  });

  it('round-trips with camelToSnake', () => {
    const original = {
      earTagNumber: '88',
      saleInfo: { saleAmount: 100, buyerContact: null as string | null },
      weights: [{ weightGain: 1.5 }],
    };
    expect(snakeToCamel(camelToSnake(original))).toEqual(original);
  });
});

describe('parseDates', () => {
  it('parses listed fields and leaves the rest alone', () => {
    const out = parseDates<{ a: Date; b: string }>(
      { a: '2026-09-01T00:00:00.000Z', b: 'x' },
      ['a'],
    );
    expect(out.a).toBeInstanceOf(Date);
    expect(out.b).toBe('x');
  });

  it('skips missing fields without throwing', () => {
    expect(parseDates({ a: 1 }, ['missing'])).toEqual({ a: 1 });
  });

  it('returns falsy input as-is', () => {
    expect(parseDates(null, ['a'])).toBeNull();
  });
});

describe('mapGoatData', () => {
  const snakeGoat = {
    id: 'g1',
    ear_tag_number: '88',
    farmer_id: 'herd-1',
    purchase_date: '2026-01-05',
    created_at: '2026-01-05T00:00:00.000Z',
    updated_at: '2026-01-06T00:00:00.000Z',
    status: 'active',
  };

  it('maps a goat without sales', () => {
    const goat = mapGoatData({ ...snakeGoat, sales: [] });
    expect(goat.earTagNumber).toBe('88');
    expect(goat.farmerId).toBe('herd-1');
    expect(goat.purchaseDate).toBeInstanceOf(Date);
    expect(goat.saleInfo).toBeUndefined();
  });

  it('attaches the first sale record as saleInfo with parsed dates', () => {
    const goat = mapGoatData({
      ...snakeGoat,
      sales: [{ id: 's1', sale_date: '2026-06-01', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }],
    });
    expect(goat.saleInfo?.id).toBe('s1');
    expect(goat.saleInfo?.saleDate).toBeInstanceOf(Date);
  });

  it('parses death_date back into a Date', () => {
    const goat = mapGoatData({
      ...snakeGoat,
      death_date: '2026-07-01T00:00:00.000Z',
      status: 'deceased',
      sales: [],
    });
    expect(goat.deathDate).toBeInstanceOf(Date);
  });
});

describe('mapExpenseData', () => {
  it('maps snake_case months and coerces the 7 fields to numbers', () => {
    const expense = mapExpenseData({
      id: 'e1',
      farmer_id: 'herd-1',
      month_key: '2026-09',
      expense_date: '2026-09-01T00:00:00.000Z',
      ilai_selavu: '100',
      kuthagai: 200,
      medicine_others: null,
      sambalam: '50.5',
      petrol: 0,
      tea_food: '20',
      selavu: '29.5',
      total: '400',
      created_at: '2026-09-30T00:00:00.000Z',
      updated_at: '2026-09-30T00:00:00.000Z',
    });
    expect(expense.monthKey).toBe('2026-09');
    expect(expense.expenseDate).toBeInstanceOf(Date);
    expect(expense.ilaiSelavu).toBe(100);
    expect(expense.kuthagai).toBe(200);
    expect(expense.medicineOthers).toBe(0);
    expect(expense.total).toBe(400);
  });
});
