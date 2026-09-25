import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

import {
  assignHerd,
  createAdminUser,
  getHerdOverview,
  getProfiles,
  listAdminUsers,
  sendPasswordReset,
  setUserBanned,
  setUserRole,
  unassignHerd,
} from '@/services/adminService';
import { getMockSupabase, lastQuery, resetMockSupabase } from '@/test/supabaseMock';

function authed() {
  getMockSupabase().auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'tok' } },
    error: null,
  });
}

function stubFetch(body: unknown, opts: { ok?: boolean; status?: number; raw?: string } = {}) {
  const { ok = true, status = 200, raw } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      text: async () => (raw !== undefined ? raw : JSON.stringify(body)),
    })),
  );
}

beforeEach(() => {
  resetMockSupabase();
  authed();
});

afterEach(() => vi.unstubAllGlobals());

describe('adminService API client', () => {
  it('lists users', async () => {
    stubFetch({ ok: true, users: [{ id: 'u1' }] });
    await expect(listAdminUsers()).resolves.toEqual([{ id: 'u1' }]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users?view=users',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('creates, resets, bans, and re-roles logins', async () => {
    stubFetch({ ok: true, userId: 'new' });
    await createAdminUser({ email: 'n@x.com', password: 'secret12', displayName: 'N', herdId: 'h' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'create', email: 'n@x.com', password: 'secret12', displayName: 'N', herdId: 'h' }),
      }),
    );

    stubFetch({ ok: true });
    await sendPasswordReset('u1');
    await setUserBanned('u1', true);
    await setUserRole('u1', 'admin');
    const bodies = vi.mocked(fetch).mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies).toContainEqual({ action: 'reset', userId: 'u1' });
    expect(bodies).toContainEqual({ action: 'ban', userId: 'u1' });
    expect(bodies).toContainEqual({ action: 'setRole', userId: 'u1', role: 'admin' });
  });

  it('unbans with the unban action', async () => {
    stubFetch({ ok: true });
    await setUserBanned('u1', false);
    const bodies = vi.mocked(fetch).mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies).toContainEqual({ action: 'unban', userId: 'u1' });
  });

  it('refuses without a session', async () => {
    getMockSupabase().auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(listAdminUsers()).rejects.toThrow('You must be signed in');
  });

  it('explains non-JSON responses (missing /api route) instead of a parse crash', async () => {
    stubFetch(null, { raw: '<!doctype html><html></html>' });
    await expect(listAdminUsers()).rejects.toThrow(/did not return JSON/);
  });

  it('explains unreachable servers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('failed');
    }));
    await expect(listAdminUsers()).rejects.toThrow(/unreachable/);
  });

  it('surfaces server-reported errors', async () => {
    stubFetch({ ok: false, error: 'Admin access required' }, { ok: false, status: 403 });
    await expect(listAdminUsers()).rejects.toThrow('Admin access required');
  });
});

describe('adminService direct herd calls', () => {
  it('assigns via upsert with the conflict target', async () => {
    resetMockSupabase();
    authed();
    await assignHerd('h1', 'u1');
    const q = lastQuery(getMockSupabase(), 'herd_members');
    expect(q.calls).toContainEqual({
      method: 'upsert',
      args: [{ herd_id: 'h1', user_id: 'u1' }, { onConflict: 'herd_id,user_id' }],
    });
  });

  it('unassigns via scoped delete', async () => {
    resetMockSupabase();
    authed();
    await unassignHerd('h1', 'u1');
    const q = lastQuery(getMockSupabase(), 'herd_members');
    expect(q.calls).toContainEqual({ method: 'delete', args: [] });
    expect(q.calls).toContainEqual({ method: 'eq', args: ['herd_id', 'h1'] });
    expect(q.calls).toContainEqual({ method: 'eq', args: ['user_id', 'u1'] });
  });

  it('builds goat counts per herd', async () => {
    resetMockSupabase({
      tables: {
        herd_members: { data: [{ herd_id: 'h1', user_id: 'u1' }], error: null },
        goats: { data: [{ id: 'g1', farmer_id: 'h1' }, { id: 'g2', farmer_id: 'h1' }, { id: 'g3', farmer_id: 'h2' }], error: null },
      },
    });
    authed();
    const overview = await getHerdOverview();
    expect(overview.memberships).toHaveLength(1);
    expect(overview.goatCounts).toEqual({ h1: 2, h2: 1 });
  });

  it('maps profiles', async () => {
    resetMockSupabase({
      tables: { profiles: { data: [{ user_id: 'u1', display_name: '' }], error: null } },
    });
    authed();
    await expect(getProfiles()).resolves.toEqual([{ userId: 'u1', displayName: 'Farmer' }]);
  });
});
