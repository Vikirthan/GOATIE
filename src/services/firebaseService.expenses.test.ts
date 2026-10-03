import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

// Fixed herd scope; everything else stays real so the device-local
// IndexedDB branch of the expense wrappers is exercised end to end.
vi.mock('@/services/supabaseService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/supabaseService')>();
  return { ...actual, getMyHerdIds: async (uid: string) => [uid, 'herd-a'] };
});

import * as indexedDB from '@/lib/indexeddb';
import { clearTestDB } from '@/test/db';
import {
  deleteOtherExpense,
  getOtherExpenses,
  recordDeath,
  saveOtherExpense,
  updateOtherExpense,
} from '@/services/firebaseService';
import type { Goat, OtherExpense } from '@/types';

const ME = 'me';

const VALUES = {
  ilaiSelavu: '100',
  kuthagai: 200,
  medicineOthers: '30',
  sambalam: '400',
  petrol: '50',
  teaFood: '60',
  selavu: '60',
};

beforeEach(async () => {
  await clearTestDB();
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_GOOGLE_SHEETS_WEBAPP_URL', '');
});

describe('firebaseService other expenses (device-local branch)', () => {
  it('saves a month with the summed total and reads it back scoped to herds', async () => {
    const saved = await saveOtherExpense(ME, '2026-09', VALUES);
    expect(saved.total).toBe(900);
    expect(saved.expenseDate).toBeInstanceOf(Date);

    const rows = await getOtherExpenses(ME);
    expect(rows.map((r) => r.monthKey)).toEqual(['2026-09']);
  });

  it('hides other herds’ months', async () => {
    await saveOtherExpense('herd-b', '2026-09', VALUES);
    await expect(getOtherExpenses(ME)).resolves.toEqual([]);
  });

  it('fails loudly on a second entry for the same month', async () => {
    await saveOtherExpense(ME, '2026-09', VALUES);
    await expect(saveOtherExpense(ME, '2026-09', VALUES)).rejects.toThrow(/already exists!/);
    // Same month in a different herd is fine.
    await expect(saveOtherExpense('herd-a', '2026-09', VALUES)).resolves.toBeDefined();
  });

  it('updates the month total and deletes the entry', async () => {
    const saved = await saveOtherExpense(ME, '2026-09', VALUES);
    await updateOtherExpense(saved.id, { ...VALUES, petrol: '150' });
    const updated = await indexedDB.getItem<OtherExpense>('expenses', saved.id);
    expect(updated?.total).toBe(1000);

    await deleteOtherExpense(saved.id);
    await expect(getOtherExpenses(ME)).resolves.toEqual([]);
  });
});

describe('firebaseService recordDeath (device-local branch)', () => {
  it('marks the cached goat deceased with a Date', async () => {
    await indexedDB.addItem('goats', {
      id: 'g1',
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
    } as Goat);
    await recordDeath('g1', new Date('2026-09-10'));
    const cached = await indexedDB.getItem<Goat>('goats', 'g1');
    expect(cached?.status).toBe('deceased');
    expect(cached?.deathDate).toBeInstanceOf(Date);
  });
});
