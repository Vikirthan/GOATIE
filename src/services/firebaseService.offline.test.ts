import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

// Herd scope with a fixed membership set; everything else stays real so the
// offline IndexedDB fallback path is exercised end to end.
vi.mock('@/services/supabaseService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/supabaseService')>();
  return { ...actual, getMyHerdIds: async (uid: string) => [uid, 'herd-a'] };
});

import * as indexedDB from '@/lib/indexeddb';
import { clearTestDB } from '@/test/db';
import { getFarmerGoats } from '@/services/firebaseService';
import type { Goat } from '@/types';

function goat(partial: Partial<Goat> & { id: string }): Goat {
  return {
    earTagNumber: 'tag-' + partial.id,
    farmerId: 'me',
    purchaseDate: new Date('2026-01-01'),
    purchaseWeight: 10,
    variant: 'LOCAL',
    gender: 'male',
    purchasePrice: 1000,
    sellerName: 'S',
    status: 'active',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...partial,
  } as Goat;
}

beforeEach(async () => {
  await clearTestDB();
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_GOOGLE_SHEETS_WEBAPP_URL', '');
});

describe('firebaseService offline fallback', () => {
  it('returns cached goats from every herd in scope, sorted newest first', async () => {
    await indexedDB.addItem('goats', goat({ id: 'own', farmerId: 'me', createdAt: new Date('2026-02-01') }));
    await indexedDB.addItem('goats', goat({ id: 'shared', farmerId: 'herd-a', createdAt: new Date('2026-03-01') }));
    await indexedDB.addItem('goats', goat({ id: 'other', farmerId: 'herd-b' }));

    const goats = await getFarmerGoats('me');
    expect(goats.map((g) => g.id)).toEqual(['shared', 'own']);
  });

  it('applies the status filter to the herd-scoped set', async () => {
    await indexedDB.addItem('goats', goat({ id: 'a1', farmerId: 'herd-a', status: 'active' }));
    await indexedDB.addItem('goats', goat({ id: 'a2', farmerId: 'herd-a', status: 'sold' }));
    const goats = await getFarmerGoats('me', 'sold');
    expect(goats.map((g) => g.id)).toEqual(['a2']);
  });

  it('returns an empty list when the cache is empty', async () => {
    await expect(getFarmerGoats('me')).resolves.toEqual([]);
  });
});
