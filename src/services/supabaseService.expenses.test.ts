import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

import * as indexedDB from '@/lib/indexeddb';
import { clearTestDB } from '@/test/db';
import { setOnline } from '@/test/setup';
import { getMockSupabase, lastQuery, queriesFor, resetMockSupabase } from '@/test/supabaseMock';
import {
  deleteOtherExpense,
  getOtherExpenses,
  recordDeath,
  saveOtherExpense,
  syncOfflineActions,
  updateOtherExpense,
} from '@/services/supabaseService';
import type { Goat, OfflineAction, OtherExpense } from '@/types';

const ME = 'user-me';
const HERD_A = 'herd-a';

function serverExpense(monthKey: string, farmerId = ME, total = 400) {
  return {
    id: `srv-${monthKey}`,
    farmer_id: farmerId,
    month_key: monthKey,
    expense_date: `${monthKey}-01T00:00:00.000Z`,
    ilai_selavu: 100,
    kuthagai: 200,
    medicine_others: 0,
    sambalam: 50,
    petrol: 20,
    tea_food: 10,
    selavu: 20,
    total,
    created_at: `${monthKey}-28T00:00:00.000Z`,
    updated_at: `${monthKey}-28T00:00:00.000Z`,
  };
}

function localExpense(monthKey: string, farmerId = ME): OtherExpense {
  return {
    id: `local-${monthKey}`,
    farmerId,
    monthKey,
    expenseDate: new Date(`${monthKey}-01T00:00:00.000Z`),
    ilaiSelavu: 1,
    kuthagai: 2,
    medicineOthers: 3,
    sambalam: 4,
    petrol: 5,
    teaFood: 6,
    selavu: 7,
    total: 28,
    createdAt: new Date(`${monthKey}-02T00:00:00.000Z`),
    updatedAt: new Date(`${monthKey}-02T00:00:00.000Z`),
  };
}

const VALUES = {
  ilaiSelavu: '100',
  kuthagai: 200,
  medicineOthers: '',
  sambalam: '50',
  petrol: 20,
  teaFood: '10',
  selavu: '20',
};

function mockScope(expenses: unknown[] = []) {
  resetMockSupabase({
    tables: {
      herd_members: { data: [{ herd_id: HERD_A, user_id: ME }], error: null },
      other_expenses: { data: expenses, error: null },
      goats: { data: [], error: null },
    },
  });
}

beforeEach(async () => {
  await clearTestDB();
  mockScope();
  setOnline(true);
});

describe('getOtherExpenses', () => {
  it('queries every visible herd with .in() and orders newest first', async () => {
    await getOtherExpenses(ME);
    const q = lastQuery(getMockSupabase(), 'other_expenses');
    const inCall = q.calls.find((c) => c.method === 'in');
    expect(inCall?.args[0]).toBe('farmer_id');
    expect(inCall?.args[1]).toEqual(expect.arrayContaining([ME, HERD_A]));
    expect(q.calls).toContainEqual({
      method: 'order',
      args: ['expense_date', { ascending: false }],
    });
  });

  it('maps snake_case months back with parsed dates and numbers', async () => {
    mockScope([serverExpense('2026-09')]);
    const [e] = await getOtherExpenses(ME);
    expect(e.monthKey).toBe('2026-09');
    expect(e.expenseDate).toBeInstanceOf(Date);
    expect(e.ilaiSelavu).toBe(100);
    expect(e.total).toBe(400);
  });

  it('mirrors server months into IndexedDB', async () => {
    mockScope([serverExpense('2026-09')]);
    await getOtherExpenses(ME);
    const cached = await indexedDB.getItem<OtherExpense>('expenses', 'srv-2026-09');
    expect(cached?.monthKey).toBe('2026-09');
  });

  it('falls back to the herd-scoped local mirror when offline', async () => {
    await indexedDB.addItem('expenses', localExpense('2026-08', ME));
    await indexedDB.addItem('expenses', { ...localExpense('2026-08', 'other-herd'), id: 'local-2026-08-other' });
    setOnline(false);
    const rows = await getOtherExpenses(ME);
    expect(rows.map((r) => r.id)).toEqual(['local-2026-08']);
  });
});

describe('saveOtherExpense', () => {
  it('inserts snake_case payload with the summed total', async () => {
    const saved = await saveOtherExpense(ME, '2026-09', VALUES);
    expect(saved.total).toBe(400);
    const q = lastQuery(getMockSupabase(), 'other_expenses');
    const insert = q.calls.find((c) => c.method === 'insert');
    expect(insert?.args[0]).toMatchObject({
      farmer_id: ME,
      month_key: '2026-09',
      ilai_selavu: 100,
      kuthagai: 200,
      total: 400,
    });
    expect(await indexedDB.getItem('expenses', saved.id)).toBeDefined();
  });

  it('fails loudly on a duplicate month without touching the server', async () => {
    await indexedDB.addItem('expenses', localExpense('2026-09', ME));
    await expect(saveOtherExpense(ME, '2026-09', VALUES)).rejects.toThrow(/already exists!/);
    expect(queriesFor(getMockSupabase(), 'other_expenses')).toHaveLength(0);
  });

  it('maps unique-violation races to the loud duplicate error', async () => {
    resetMockSupabase({
      tables: {
        herd_members: { data: [], error: null },
        other_expenses: {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        },
      },
    });
    await expect(saveOtherExpense(ME, '2026-09', VALUES)).rejects.toThrow(/already exists!/);
  });

  it('queues offline creates for later sync', async () => {
    setOnline(false);
    const saved = await saveOtherExpense(ME, '2026-09', VALUES);
    expect(await indexedDB.getItem('expenses', saved.id)).toBeDefined();
    const queued = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
    expect(queued.some((a) => a.type === 'create' && a.collection === 'expenses')).toBe(true);
  });
});

describe('updateOtherExpense / deleteOtherExpense', () => {
  it('updates the total and mirrors locally', async () => {
    await indexedDB.addItem('expenses', localExpense('2026-09', ME));
    await updateOtherExpense('local-2026-09', { ...VALUES, sambalam: '100' });
    const q = lastQuery(getMockSupabase(), 'other_expenses');
    expect(q.calls).toContainEqual({ method: 'update', args: [expect.objectContaining({ total: 450 })] });
    const cached = await indexedDB.getItem<OtherExpense>('expenses', 'local-2026-09');
    expect(cached?.total).toBe(450);
  });

  it('deletes server-side and locally', async () => {
    await indexedDB.addItem('expenses', localExpense('2026-09', ME));
    await deleteOtherExpense('local-2026-09');
    const q = lastQuery(getMockSupabase(), 'other_expenses');
    expect(q.calls).toContainEqual({ method: 'delete', args: [] });
    expect(await indexedDB.getItem('expenses', 'local-2026-09')).toBeUndefined();
  });
});

describe('recordDeath', () => {
  const localGoat = (id: string): Goat =>
    ({
      id,
      earTagNumber: 'D1',
      farmerId: ME,
      purchaseDate: new Date('2026-01-01'),
      purchaseWeight: 10,
      variant: 'LOCAL',
      gender: 'male',
      purchasePrice: 1000,
      sellerName: 'S',
      status: 'active',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }) as Goat;

  it('marks the goat deceased with death_date and mirrors locally', async () => {
    await indexedDB.addItem('goats', localGoat('g-dead'));
    await recordDeath('g-dead', new Date('2026-09-10'));
    const q = lastQuery(getMockSupabase(), 'goats');
    const update = q.calls.find((c) => c.method === 'update');
    expect(update?.args[0]).toMatchObject({ status: 'deceased' });
    expect((update?.args[0] as Record<string, unknown>)?.death_date).toBeInstanceOf(Date);
    const cached = await indexedDB.getItem<Goat>('goats', 'g-dead');
    expect(cached?.status).toBe('deceased');
    expect(cached?.deathDate).toBeInstanceOf(Date);
  });

  it('queues the death offline and syncs it later', async () => {
    await indexedDB.addItem('goats', localGoat('g-off'));
    setOnline(false);
    await recordDeath('g-off', new Date('2026-09-10'));
    expect((await indexedDB.getItem<Goat>('goats', 'g-off'))?.status).toBe('deceased');
    const queued = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
    expect(queued.some((a) => a.type === 'update' && a.collection === 'goats')).toBe(true);

    setOnline(true);
    await syncOfflineActions();
    const q = lastQuery(getMockSupabase(), 'goats');
    expect(q.calls.some((c) => c.method === 'update')).toBe(true);
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
  });
});

describe('syncOfflineActions (expenses)', () => {
  it('pushes queued expense creates and logs history', async () => {
    resetMockSupabase();
    await indexedDB.addItem('offlineQueue', {
      id: 'action-exp-1',
      type: 'create',
      collection: 'expenses',
      data: { expense: localExpense('2026-09', ME) },
      timestamp: new Date(),
      synced: false,
    } as OfflineAction);
    await syncOfflineActions();
    const q = lastQuery(getMockSupabase(), 'other_expenses');
    expect(q.calls.some((c) => c.method === 'insert')).toBe(true);
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
    const history = await indexedDB.getAllItems<{ description: string }>('syncHistory');
    expect(history.some((h) => h.description.includes('2026-09'))).toBe(true);
  });

  it('drops RLS-rejected expense actions instead of retrying forever', async () => {
    resetMockSupabase({
      tables: {
        other_expenses: {
          data: null,
          error: { code: '42501', message: 'new row violates row-level security policy' },
        },
      },
    });
    await indexedDB.addItem('offlineQueue', {
      id: 'action-exp-2',
      type: 'create',
      collection: 'expenses',
      data: { expense: localExpense('2026-10', ME) },
      timestamp: new Date(),
      synced: false,
    } as OfflineAction);
    await syncOfflineActions();
    await syncOfflineActions();
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
    const history = await indexedDB.getAllItems<{ description: string }>('syncHistory');
    expect(history.some((h) => h.description.startsWith('Failed'))).toBe(true);
  });
});
