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
  getFarmerGoats,
  getHerdScope,
  getMyHerdIds,
  syncOfflineActions,
} from '@/services/supabaseService';
import type { Goat, OfflineAction } from '@/types';

const ME = 'user-me';
const HERD_A = 'herd-a';

function goat(partial: Partial<Goat> & { id: string }): Goat {
  return {
    earTagNumber: 'tag-' + partial.id,
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
    ...partial,
  } as Goat;
}

function serverGoat(id: string, ear: string, farmerId = ME) {
  return {
    id, ear_tag_number: ear, farmer_id: farmerId, status: 'active',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function queueCreate(id: string, farmerId: string, ear = 'q-tag'): OfflineAction {
  return {
    id: `action-${id}`,
    type: 'create',
    collection: 'goats',
    data: { goat: goat({ id, farmerId, earTagNumber: ear }), weights: [] },
    timestamp: new Date(),
    synced: false,
  };
}

beforeEach(async () => {
  await clearTestDB();
  resetMockSupabase();
  setOnline(true);
});

describe('getMyHerdIds', () => {
  it('merges self id with server memberships and refreshes the cache', async () => {
    resetMockSupabase({
      tables: { herd_members: { data: [{ herd_id: HERD_A, user_id: ME }], error: null } },
    });
    const ids = await getMyHerdIds(ME);
    expect(ids).toContain(ME);
    expect(ids).toContain(HERD_A);

    const cached = await indexedDB.getAllItems<{ id: string; userId: string }>('memberships');
    expect(cached.map((c) => c.id)).toContain(HERD_A);
  });

  it('uses an unfiltered membership query so RLS scopes it (admins see all)', async () => {
    resetMockSupabase({
      tables: {
        herd_members: {
          data: [
            { herd_id: 'herd-other', user_id: 'someone-else' },
            { herd_id: HERD_A, user_id: ME },
          ],
          error: null,
        },
      },
    });
    await getMyHerdIds(ME);
    const q = lastQuery(getMockSupabase(), 'herd_members');
    expect(q.calls.some((c) => c.method === 'eq')).toBe(false);
    const ids = await getMyHerdIds(ME);
    // Rows visible through RLS (e.g. admin seeing every herd) join the scope…
    expect(ids).toContain('herd-other');
    // …but only own rows are cached or writable.
    const cached = await indexedDB.getAllItems<{ id: string; userId: string }>('memberships');
    expect(cached.map((c) => c.id)).toEqual([HERD_A]);
    const scope = await getHerdScope(ME);
    expect(scope.writableHerdIds.sort()).toEqual([HERD_A, ME].sort());
    expect(scope.writableHerdIds).not.toContain('herd-other');
  });

  it('prunes revoked memberships from the cache', async () => {
    resetMockSupabase({
      tables: { herd_members: { data: [{ herd_id: HERD_A, user_id: ME }], error: null } },
    });
    await indexedDB.addItem('memberships', { id: 'revoked', userId: ME } as never);
    const ids = await getMyHerdIds(ME);
    expect(ids).not.toContain('revoked');
    expect(await indexedDB.getItem('memberships', 'revoked')).toBeUndefined();
  });

  it('falls back to self + cache when offline', async () => {
    await indexedDB.addItem('memberships', { id: HERD_A, userId: ME } as never);
    setOnline(false);
    const ids = await getMyHerdIds(ME);
    expect(ids.sort()).toEqual([HERD_A, ME].sort());
  });

  it('survives a missing table (pre-migration) with self + cache', async () => {
    resetMockSupabase({
      tables: { herd_members: { data: null, error: new Error('relation does not exist') } },
    });
    await expect(getMyHerdIds(ME)).resolves.toEqual([ME]);
  });
});

describe('getFarmerGoats herd scope', () => {
  beforeEach(() => {
    resetMockSupabase({
      tables: {
        herd_members: { data: [{ herd_id: HERD_A, user_id: ME }], error: null },
        goats: { data: [serverGoat('g1', '88', ME)], error: null },
      },
    });
  });

  it('queries all herds with .in(), not a single farmer_id', async () => {
    await getFarmerGoats(ME);
    const q = lastQuery(getMockSupabase(), 'goats');
    const inCall = q.calls.find((c) => c.method === 'in');
    expect(inCall?.args[0]).toBe('farmer_id');
    expect(inCall?.args[1]).toEqual(expect.arrayContaining([ME, HERD_A]));
    expect(q.calls.some((c) => c.method === 'eq' && c.args[0] === 'farmer_id')).toBe(false);
  });

  it('applies the status filter on top of herd scope', async () => {
    await getFarmerGoats(ME, 'sold');
    const q = lastQuery(getMockSupabase(), 'goats');
    expect(q.calls).toContainEqual({ method: 'eq', args: ['status', 'sold'] });
  });

  it('prunes cached goats from herds the login left', async () => {
    await indexedDB.addItem('goats', goat({ id: 'stale', farmerId: 'old-herd' }));
    await getFarmerGoats(ME);
    await vi.waitFor(async () => {
      expect(await indexedDB.getItem('goats', 'stale')).toBeUndefined();
    });
  });
});

describe('legacy herd adoption', () => {
  const vikiGoat = () => goat({ id: 'legacy-1', farmerId: 'VIKI', earTagNumber: 'V1' });

  function mockTables(serverRows: unknown[] = []) {
    resetMockSupabase({
      tables: {
        herd_members: { data: [], error: null },
        goats: { data: serverRows, error: null },
        weights: { data: [], error: null },
        deworming: { data: [], error: null },
        vaccinations: { data: [], error: null },
        sales: { data: [], error: null },
      },
      auth: {
        getUser: async () => ({ data: { user: { email: 'vikirthan06@gmail.com' } }, error: null }),
      },
    });
  }

  it('pushes the login’s own legacy rows (goat + weights) into their herd', async () => {
    mockTables([]);
    await indexedDB.addItem('goats', vikiGoat());
    await indexedDB.addItem('weights', {
      id: 'w1', goatId: 'legacy-1', weightNumber: 0, weight: 9,
      dueDate: new Date(), isRecorded: true, createdAt: new Date(), updatedAt: new Date(),
    } as never);

    await getFarmerGoats('viki-uuid');

    const inserts = queriesFor(getMockSupabase(), 'goats')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(inserts.length).toBeGreaterThan(0);
    const weightInserts = queriesFor(getMockSupabase(), 'weights')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(weightInserts.length).toBeGreaterThan(0);
    const local = await indexedDB.getItem<Goat>('goats', 'legacy-1');
    expect(local?.farmerId).toBe('viki-uuid');
  });

  it('drops legacy rows whose ear tag already exists on the server', async () => {
    mockTables([serverGoat('srv-1', 'V1', 'viki-uuid')]);
    await indexedDB.addItem('goats', vikiGoat());

    await getFarmerGoats('viki-uuid');

    const inserts = queriesFor(getMockSupabase(), 'goats')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(inserts).toHaveLength(0);
    expect(await indexedDB.getItem('goats', 'legacy-1')).toBeUndefined();
  });

  it('never adopts another farmer’s legacy rows', async () => {
    mockTables([]);
    getMockSupabase().auth.getUser.mockResolvedValue({
      data: { user: { email: 'rkte4e@gmail.com' } },
      error: null,
    });
    await indexedDB.addItem('goats', vikiGoat());

    await getFarmerGoats('rkt-uuid');

    const inserts = queriesFor(getMockSupabase(), 'goats')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(inserts).toHaveLength(0);
    // Untouched here; the general prune pass removes it as out-of-scope.
  });

  it('does nothing when there is no signed-in user', async () => {
    mockTables([]);
    getMockSupabase().auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await indexedDB.addItem('goats', vikiGoat());
    await getFarmerGoats('viki-uuid');
    const inserts = queriesFor(getMockSupabase(), 'goats')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(inserts).toHaveLength(0);
  });
});

describe('syncOfflineActions', () => {
  it('drops stale demo-id queue entries without touching the server', async () => {
    resetMockSupabase();
    await indexedDB.addItem('offlineQueue', queueCreate('d1', 'RKT'));
    await syncOfflineActions();
    expect(queriesFor(getMockSupabase(), 'goats')).toHaveLength(0);
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
  });

  it('syncs queued creates and logs history', async () => {
    resetMockSupabase();
    await indexedDB.addItem('offlineQueue', queueCreate('c1', ME, 'C1'));
    await syncOfflineActions();
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
    const history = await indexedDB.getAllItems<{ description: string }>('syncHistory');
    expect(history.some((h) => h.description.includes('C1'))).toBe(true);
  });

  it('drops RLS-rejected actions into history instead of retrying forever', async () => {
    resetMockSupabase({
      tables: {
        goats: (calls) =>
          calls.some((c) => c.method === 'insert')
            ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
            : { data: [], error: null },
        weights: { data: [], error: null },
      },
    });
    await indexedDB.addItem('offlineQueue', queueCreate('c2', ME, 'C2'));
    await syncOfflineActions();
    await syncOfflineActions();
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(0);
    const history = await indexedDB.getAllItems<{ description: string }>('syncHistory');
    expect(history.some((h) => h.description.startsWith('Failed'))).toBe(true);
  });

  it('keeps transiently-failed actions queued for retry', async () => {
    resetMockSupabase({
      tables: {
        goats: { data: null, error: { code: null, message: 'network down' } },
        weights: { data: [], error: null },
      },
    });
    await indexedDB.addItem('offlineQueue', queueCreate('c3', ME, 'C3'));
    await syncOfflineActions();
    expect(await indexedDB.getAllItems('offlineQueue')).toHaveLength(1);
    expect(await indexedDB.getAllItems('syncHistory')).toHaveLength(0);
  });
});
