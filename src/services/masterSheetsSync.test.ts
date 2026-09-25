import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMasterSyncStatus,
  needsDailyPush,
  restoreFromSheets,
  restoreToDatabase,
  triggerMasterSync,
} from '@/services/masterSheetsSync';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

import { resetMockSupabase } from '@/test/supabaseMock';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('needsDailyPush', () => {
  it('requires a push when never synced', () => {
    expect(needsDailyPush(null)).toBe(true);
  });

  it('skips when the last sync was today', () => {
    const now = new Date(2026, 8, 25, 10, 0, 0);
    expect(needsDailyPush(new Date(2026, 8, 25, 8, 0, 0).getTime(), now)).toBe(false);
  });

  it('pushes across day, month, and year boundaries', () => {
    expect(needsDailyPush(new Date(2026, 8, 24, 23, 59).getTime(), new Date(2026, 8, 25, 0, 1))).toBe(true);
    expect(needsDailyPush(new Date(2026, 7, 31).getTime(), new Date(2026, 8, 1))).toBe(true);
    expect(needsDailyPush(new Date(2025, 11, 31).getTime(), new Date(2026, 0, 1))).toBe(true);
  });
});

describe('triggerMasterSync', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns the summary on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      ok: true,
      summary: [{ tab: 'Goats Data', added: 2, updated: 0, deleted: 0 }],
      fullRewrite: false,
      ranAt: 123,
    }) as unknown as Response);
    const res = await triggerMasterSync();
    expect(res).toMatchObject({ ok: true, fullRewrite: false, ranAt: 123 });
    expect(res.tabs?.[0]).toMatchObject({ tab: 'Goats Data', added: 2 });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/master-sync', expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces server errors without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false, error: 'Boom' }) as unknown as Response);
    const res = await triggerMasterSync();
    expect(res).toMatchObject({ ok: false, error: 'Boom' });
  });

  it('surfaces HTTP failures without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    const res = await triggerMasterSync();
    expect(res.ok).toBe(false);
  });
});

describe('fetchMasterSyncStatus', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('maps the status payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      ok: true, lastSyncAt: 456, rewriteMonth: '2026-09', lastResult: [],
    }) as unknown as Response);
    await expect(fetchMasterSyncStatus()).resolves.toMatchObject({ lastSyncAt: 456 });
  });

  it('throws when the server reports failure', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false, error: 'Nope' }) as unknown as Response);
    await expect(fetchMasterSyncStatus()).rejects.toThrow('Nope');
  });
});

describe('restoreFromSheets', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('maps the four tabs', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      ok: true,
      tabs: { 'Goats Data': [{ id: 'g1' }], 'Monthly Weights': [], Deworming: [], Vaccination: [] },
    }) as unknown as Response);
    const res = await restoreFromSheets();
    expect(res.ok).toBe(true);
    expect(res.data?.goats).toEqual([{ id: 'g1' }]);
  });
});

describe('restoreToDatabase', () => {
  beforeEach(() => {
    resetMockSupabase({
      tables: {
        goats: { data: [], error: null },
        weights: { data: [], error: null },
        deworming: { data: [], error: null },
        vaccinations: { data: [], error: null },
        sales: { data: [], error: null },
      },
    });
  });

  it('anchors restored goats to the given herd and skips existing ids', async () => {
    const { getMockSupabase, lastQuery } = await import('@/test/supabaseMock');
    const mock = getMockSupabase();
    const result = await restoreToDatabase('herd-1', {
      goats: [{ id: 'g1', earTagNumber: '88', gender: 'male', status: 'active' }],
      weights: [{ id: 'w1', earTagNumber: '88', weightNumber: 1, weight: 10 }],
      dewormings: [],
      vaccinations: [],
    });
    expect(result.ok).toBe(true);
    expect(result.added.goats).toBe(1);
    expect(result.added.weights).toBe(1);

    const goatInsert = lastQuery(mock, 'goats');
    const insertedRows = goatInsert.calls.find((c) => c.method === 'insert')?.args[0] as Record<string, unknown>[];
    expect(insertedRows[0].farmer_id).toBe('herd-1');
  });

  it('skips ids already present (incremental, safe to re-run)', async () => {
    resetMockSupabase({
      tables: {
        goats: { data: [{ id: 'g1' }], error: null },
        weights: { data: [], error: null },
        deworming: { data: [], error: null },
        vaccinations: { data: [], error: null },
        sales: { data: [], error: null },
      },
    });
    const result = await restoreToDatabase('herd-1', {
      goats: [{ id: 'g1', earTagNumber: '88', gender: 'male', status: 'active' }],
      weights: [],
      dewormings: [],
      vaccinations: [],
    });
    expect(result.added.goats).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });
});
