import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { getMockSupabase } = await vi.importActual('@/test/supabaseMock') as typeof import('@/test/supabaseMock');
  return { supabase: getMockSupabase() };
});

import {
  ensureUserProfile,
  ensureUserRole,
  getAuthToken,
  loginWithEmail,
  logout,
  onAuthChange,
  registerWithEmail,
} from '@/services/authService';
import { getMockSupabase, resetMockSupabase } from '@/test/supabaseMock';

const DB_USER = {
  id: 'user-1',
  email: 'Farmer@X.com',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  user_metadata: {},
};

beforeEach(() => {
  resetMockSupabase();
  localStorage.clear();
});

describe('loginWithEmail', () => {
  it('signs in with trimmed email via Supabase only (no demo backdoor)', async () => {
    const mock = getMockSupabase();
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: DB_USER }, error: null });
    const user = await loginWithEmail('  farmer@x.com ', 'secret12');
    expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'farmer@x.com', password: 'secret12' });
    expect(user).toMatchObject({ id: 'user-1', email: 'Farmer@X.com' });
    expect(localStorage.getItem('goatie_logged_in_user')).toBeNull();
  });

  it('rejects legacy demo usernames instead of logging in', async () => {
    const mock = getMockSupabase();
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: new Error('Invalid login') });
    await expect(loginWithEmail('RKT', 'whatever')).rejects.toThrow('Invalid login');
    expect(localStorage.getItem('goatie_logged_in_user')).toBeNull();
  });

  it('clears any stale demo session on the way in', async () => {
    const mock = getMockSupabase();
    localStorage.setItem('goatie_logged_in_user', '{"id":"RKT"}');
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: DB_USER }, error: null });
    await loginWithEmail('a@x.com', 'secret12');
    expect(localStorage.getItem('goatie_logged_in_user')).toBeNull();
  });

  it('notifies auth listeners on login', async () => {
    const mock = getMockSupabase();
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: DB_USER }, error: null });
    mock.auth.getSession.mockResolvedValue({ data: { session: null } });
    const seen: (string | null)[] = [];
    const unsub = onAuthChange((u) => seen.push(u ? u.id : null));
    await loginWithEmail('a@x.com', 'secret12');
    // Initial getSession(null) fires first, then the login notification.
    expect(seen).toContain('user-1');
    unsub();
  });
});

describe('registerWithEmail', () => {
  it('registers and maps the display name', async () => {
    const mock = getMockSupabase();
    mock.auth.signUp.mockResolvedValue({ data: { user: DB_USER }, error: null });
    const user = await registerWithEmail('a@x.com', 'secret12', 'New Farmer');
    expect(mock.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@x.com', password: 'secret12' }),
    );
    expect(user.displayName).toBe('New Farmer');
  });

  it('throws when Supabase reports no user', async () => {
    getMockSupabase().auth.signUp.mockResolvedValue({ data: { user: null }, error: null });
    await expect(registerWithEmail('a@x.com', 'secret12', 'N')).rejects.toThrow();
  });
});

describe('logout / getAuthToken', () => {
  it('logout clears listeners first, then signs out', async () => {
    const mock = getMockSupabase();
    mock.auth.getSession.mockResolvedValue({ data: { session: null } });
    const seen: (string | null)[] = [];
    const unsub = onAuthChange((u) => seen.push(u ? u.id : null));
    await logout();
    expect(seen[seen.length - 1]).toBeNull();
    expect(mock.auth.signOut).toHaveBeenCalled();
    unsub();
  });

  it('getAuthToken returns the session token or null', async () => {
    const mock = getMockSupabase();
    mock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    await expect(getAuthToken()).resolves.toBe('tok');
    mock.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getAuthToken()).resolves.toBeNull();
  });
});

describe('onAuthChange', () => {
  it('emits the cached session, then live state changes', async () => {
    const mock = getMockSupabase();
    mock.auth.getSession.mockResolvedValue({ data: { session: { user: DB_USER } } });
    let liveCb: ((event: string, session: unknown) => void) | null = null;
    mock.auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      liveCb = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const seen: (string | null)[] = [];
    const unsub = onAuthChange((u) => seen.push(u ? u.id : null));
    await vi.waitFor(() => expect(seen).toEqual(['user-1']));
    const fire = liveCb as ((event: string, session: unknown) => void) | null;
    if (!fire) throw new Error('onAuthStateChange callback was not captured');
    fire('SIGNED_OUT', null);
    expect(seen).toEqual(['user-1', null]);
    unsub();
  });
});

describe('roles', () => {
  it('ensureUserRole bootstraps farmer for new logins, keeps existing', async () => {
    const mock = getMockSupabase();
    mock._tables.user_roles = { data: null, error: null };
    await expect(ensureUserRole('new')).resolves.toBe('farmer');
    const inserts = mock._queries
      .filter((q) => q.table === 'user_roles')
      .flatMap((q) => q.calls.filter((c) => c.method === 'insert'));
    expect(inserts[0]?.args[0]).toMatchObject({ user_id: 'new', role: 'farmer' });

    mock._tables.user_roles = { data: { user_id: 'a', role: 'admin' }, error: null };
    await expect(ensureUserRole('a')).resolves.toBe('admin');
  });

  it('ensureUserProfile upserts and never throws pre-migration', async () => {
    const mock = getMockSupabase();
    await expect(ensureUserProfile('u', ' RKT ')).resolves.toBeUndefined();
    const upserts = mock._queries
      .filter((q) => q.table === 'profiles')
      .flatMap((q) => q.calls.filter((c) => c.method === 'upsert'));
    expect(upserts[0]?.args[0]).toMatchObject({ user_id: 'u', display_name: 'RKT' });

    mock._tables.profiles = { data: null, error: new Error('no table') };
    await expect(ensureUserProfile('u', '')).resolves.toBeUndefined();
  });
});
