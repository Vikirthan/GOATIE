// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock');
  return { createClient: () => getMockSupabase() };
});

import handler from './users';
import { getMockSupabase, resetMockSupabase } from '@/test/supabaseMock';

const ADMIN_ID = 'admin-uuid';
const FARMER_ID = 'farmer-uuid';

// The handler builds its Supabase clients from env (like production) — the
// client constructor itself is mocked, but the env gates still apply.
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});

function mockReq(over: Record<string, unknown> = {}) {
  return { method: 'GET', query: {}, headers: {}, body: {}, ...over } as never;
}

function mockRes() {
  const r: { statusCode?: number; body?: unknown; status: unknown; json: unknown } = {
    status: null,
    json: null,
  };
  r.status = vi.fn((code: number) => {
    r.statusCode = code;
    return r;
  });
  r.json = vi.fn((body: unknown) => {
    r.body = body;
    return r;
  });
  return r as unknown as { statusCode: number; body: Record<string, unknown> };
}

function authedAs(userId: string | null, role: string | null = 'admin') {
  const mock = getMockSupabase();
  mock.auth.getUser.mockResolvedValue(
    userId
      ? { data: { user: { id: userId, email: `${userId}@x.com` } }, error: null }
      : { data: { user: null }, error: new Error('invalid token') },
  );
  mock._tables.user_roles =
    userId && role
      ? { data: { user_id: userId, role }, error: null }
      : { data: null, error: null };
  return mock;
}

function authedReq(body: unknown = {}, method = 'POST') {
  return mockReq({ method, body, headers: { authorization: 'Bearer good-token' } });
}

describe('admin/users auth gate', () => {
  beforeEach(() => {
    resetMockSupabase();
    getMockSupabase().auth.admin = {};
  });

  it('rejects requests without a bearer token', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'users' } }), res as never);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ ok: false });
  });

  it('rejects invalid tokens', async () => {
    authedAs(null);
    const res = mockRes();
    await handler(authedReq({}, 'GET'), res as never);
    expect(res.statusCode).toBe(403);
  });

  it('rejects non-admin callers', async () => {
    authedAs(FARMER_ID, 'farmer');
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'users' }, headers: { authorization: 'Bearer t' } }), res as never);
    expect(res.statusCode).toBe(403);
  });

  it('rejects callers with no role row', async () => {
    authedAs(FARMER_ID, null);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'users' }, headers: { authorization: 'Bearer t' } }), res as never);
    expect(res.statusCode).toBe(403);
  });

  it('rejects unsupported methods', async () => {
    authedAs(ADMIN_ID, 'admin');
    const res = mockRes();
    await handler(mockReq({ method: 'DELETE', headers: { authorization: 'Bearer t' } }), res as never);
    expect(res.statusCode).toBe(405);
  });

  it('fails closed when the service key is missing, even for admins', async () => {
    authedAs(ADMIN_ID, 'admin');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'users' }, headers: { authorization: 'Bearer t' } }), res as never);
    expect(res.statusCode).toBe(403);
  });
});

describe('admin/users list', () => {
  beforeEach(() => {
    const mock = resetMockSupabase();
    authedAs(ADMIN_ID, 'admin');
    // Single-row for the requireAdmin maybeSingle lookup, full list otherwise.
    mock._tables.user_roles = (calls) =>
      calls.some((c) => c.method === 'maybeSingle')
        ? { data: { user_id: ADMIN_ID, role: 'admin' }, error: null }
        : {
            data: [
              { user_id: ADMIN_ID, role: 'admin' },
              { user_id: FARMER_ID, role: 'farmer' },
            ],
            error: null,
          };
    mock.auth.admin = {
      listUsers: vi.fn(async () => ({
        data: {
          users: [
            { id: ADMIN_ID, email: 'a@x.com', user_metadata: { display_name: ' boss ' }, banned_until: null },
            { id: FARMER_ID, email: 'f@x.com', user_metadata: {}, banned_until: new Date(Date.now() + 999999).toISOString() },
            { id: 'old-ban', email: 'o@x.com', user_metadata: {}, banned_until: new Date(Date.now() - 9999).toISOString() },
          ],
        },
        error: null,
      })),
    };
    mock._tables.herd_members = {
      data: [
        { herd_id: 'h1', user_id: ADMIN_ID },
        { herd_id: 'h1', user_id: FARMER_ID },
      ],
      error: null,
    };
  });

  it('lists users with roles, herds, and ban state', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'users' }, headers: { authorization: 'Bearer t' } }), res as never);
    expect(res.statusCode).toBe(200);
    const users = res.body.users as { id: string; role: string; banned: boolean; herds: string[]; displayName: string }[];
    expect(users).toHaveLength(3);
    expect(users.find((u) => u.id === ADMIN_ID)).toMatchObject({ role: 'admin', displayName: ' boss ' });
    expect(users.find((u) => u.id === FARMER_ID)).toMatchObject({ role: 'farmer', banned: true, herds: ['h1'] });
    expect(users.find((u) => u.id === FARMER_ID)?.banned).toBe(true);
    expect(users.find((u) => u.id === 'old-ban')?.banned).toBe(false);
  });
});

describe('admin/users create', () => {
  beforeEach(() => {
    const mock = resetMockSupabase();
    authedAs(ADMIN_ID, 'admin');
    mock.auth.admin = {
      createUser: vi.fn(async () => ({ data: { user: { id: 'new-uuid' } }, error: null })),
    };
  });

  it('validates email and password length', async () => {
    for (const body of [
      { action: 'create', email: '', password: 'longenough' },
      { action: 'create', email: 'a@x.com', password: 'short' },
    ]) {
      const res = mockRes();
      await handler(authedReq(body), res as never);
      expect(res.statusCode).toBe(400);
    }
  });

  it('creates the login and seeds role + self-membership', async () => {
    const mock = getMockSupabase();
    const res = mockRes();
    await handler(
      authedReq({ action: 'create', email: 'n@x.com', password: 'secret12', displayName: 'New' }),
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, userId: 'new-uuid' });
    expect(mock.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'n@x.com', email_confirm: true }),
    );
    const upserts = mock._queries
      .filter((q) => q.table === 'herd_members')
      .flatMap((q) => q.calls.filter((c) => c.method === 'upsert'));
    // Self-membership row for the new login.
    expect(upserts.some((c) => (c.args[0] as { herd_id: string }).herd_id === 'new-uuid')).toBe(true);
  });

  it('optionally assigns the new login to an existing herd', async () => {
    const mock = getMockSupabase();
    const res = mockRes();
    await handler(
      authedReq({ action: 'create', email: 'n@x.com', password: 'secret12', displayName: 'N', herdId: 'herd-A' }),
      res as never,
    );
    expect(res.statusCode).toBe(200);
    const upserts = mock._queries
      .filter((q) => q.table === 'herd_members')
      .flatMap((q) => q.calls.filter((c) => c.method === 'upsert'));
    expect(upserts.some((c) => (c.args[0] as { herd_id: string }).herd_id === 'herd-A')).toBe(true);
  });

  it('surfaces Auth failures as 500', async () => {
    getMockSupabase().auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: new Error('email exists'),
    });
    const res = mockRes();
    await handler(
      authedReq({ action: 'create', email: 'n@x.com', password: 'secret12', displayName: 'N' }),
      res as never,
    );
    expect(res.statusCode).toBe(500);
  });
});

describe('admin/users reset/ban/role', () => {
  beforeEach(() => {
    const mock = resetMockSupabase();
    authedAs(ADMIN_ID, 'admin');
    mock.auth.admin = {
      getUserById: vi.fn(async (id: string) => ({
        data: { user: id === 'no-email' ? { id } : { id, email: `${id}@x.com` } },
        error: null,
      })),
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
    };
    mock.auth.resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
  });

  it('reset requires userId and a user email', async () => {
    const empty = mockRes();
    await handler(authedReq({ action: 'reset' }), empty as never);
    expect(empty.statusCode).toBe(400);

    const noEmail = mockRes();
    await handler(authedReq({ action: 'reset', userId: 'no-email' }), noEmail as never);
    expect(noEmail.statusCode).toBe(500);
  });

  it('reset sends a recovery email', async () => {
    const mock = getMockSupabase();
    const res = mockRes();
    await handler(authedReq({ action: 'reset', userId: FARMER_ID }), res as never);
    expect(res.statusCode).toBe(200);
    expect(mock.auth.resetPasswordForEmail).toHaveBeenCalledWith(`${FARMER_ID}@x.com`, undefined);
  });

  it('refuses to ban your own admin login', async () => {
    const res = mockRes();
    await handler(authedReq({ action: 'ban', userId: ADMIN_ID }), res as never);
    expect(res.statusCode).toBe(400);
  });

  it('bans and unbans other logins', async () => {
    const mock = getMockSupabase();
    const ban = mockRes();
    await handler(authedReq({ action: 'ban', userId: FARMER_ID }), ban as never);
    expect(ban.statusCode).toBe(200);
    expect(mock.auth.admin.updateUserById).toHaveBeenCalledWith(FARMER_ID, { ban_duration: '876000h' });

    const unban = mockRes();
    await handler(authedReq({ action: 'unban', userId: FARMER_ID }), unban as never);
    expect(unban.statusCode).toBe(200);
    expect(mock.auth.admin.updateUserById).toHaveBeenCalledWith(FARMER_ID, { ban_duration: 'none' });
  });

  it('validates setRole and refuses self-demotion', async () => {
    const bad = mockRes();
    await handler(authedReq({ action: 'setRole', userId: FARMER_ID, role: 'superuser' }), bad as never);
    expect(bad.statusCode).toBe(400);

    const self = mockRes();
    await handler(authedReq({ action: 'setRole', userId: ADMIN_ID, role: 'farmer' }), self as never);
    expect(self.statusCode).toBe(400);
  });

  it('rejects unknown actions', async () => {
    const res = mockRes();
    await handler(authedReq({ action: 'explode' }), res as never);
    expect(res.statusCode).toBe(400);
  });
});
