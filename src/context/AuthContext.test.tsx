import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  onAuthChange: vi.fn(),
  ensureUserRole: vi.fn(),
  ensureUserProfile: vi.fn(),
}));

vi.mock('@/services/authService', () => authMocks);

const herdMocks = vi.hoisted(() => ({
  getHerdScope: vi.fn(),
}));

vi.mock('@/services/supabaseService', () => herdMocks);

const profilesMock = vi.hoisted(() => ({
  getProfiles: vi.fn(async () => [] as { userId: string; displayName: string }[]),
}));

vi.mock('@/services/adminService', () => profilesMock);

import { AuthProvider, useAuth } from '@/context/AuthContext';
import type { User } from '@/types';

const DB_USER = {
  id: 'u1',
  email: 'u1@x.com',
  displayName: 'U One',
  role: 'farmer',
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

let liveCb: ((u: User | null) => void) | null = null;

function renderProbe() {
  let latest: ReturnType<typeof useAuth> | null = null;
  const Probe = () => {
    latest = useAuth();
    return null;
  };
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return () => {
    if (!latest) throw new Error('context never rendered');
    return latest;
  };
}

function setup() {
  liveCb = null;
  localStorage.clear();
  authMocks.onAuthChange.mockImplementation((c: (u: User | null) => void) => {
    liveCb = c;
    return () => {
      liveCb = null;
    };
  });
  authMocks.ensureUserRole.mockResolvedValue('farmer');
  authMocks.ensureUserProfile.mockResolvedValue(undefined);
  herdMocks.getHerdScope.mockImplementation(async (uid: string) => ({
    herdIds: [uid],
    writableHerdIds: [uid],
  }));
  return renderProbe();
}

async function settle() {
  await act(async () => {
    await vi.waitFor(() => {
      expect(authMocks.onAuthChange).toHaveBeenCalled();
    });
  });
}

// Drives the captured auth callback and flushes the provider's background
// task (role/herds resolve) inside act — the task is fire-and-forget, so an
// explicit beat is needed instead of bare waitFor.
async function emitAndFlush(user: User | null) {
  await act(async () => {
    liveCb?.(user);
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe('AuthContext', () => {
  it('starts signed out with safe defaults', async () => {
    const get = setup();
    act(() => {
      liveCb?.(null);
    });
    await settle();
    const ctx = get();
    expect(ctx.user).toBeNull();
    expect(ctx.role).toBeNull();
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.herdIds).toEqual([]);
    expect(ctx.activeHerdId).toBeNull();
    expect(ctx.loading).toBe(false);
  });

  it('resolves role, herds, and defaults the active herd to self', async () => {
    const get = setup();
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1', 'h-shared'], writableHerdIds: ['u1', 'h-shared'] });
    await emitAndFlush(DB_USER);
    const ctx = get();
    expect(ctx.user?.id).toBe('u1');
    expect(ctx.role).toBe('farmer');
    expect(ctx.herdIds).toEqual(['u1', 'h-shared']);
    expect(ctx.activeHerdId).toBe('u1');
    expect(ctx.loading).toBe(false);
    expect(authMocks.ensureUserRole).toHaveBeenCalledWith('u1');
    expect(authMocks.ensureUserProfile).toHaveBeenCalledWith('u1', 'U One');
  });

  it('restores a valid stored herd, ignores a revoked one', async () => {
    const get = setup();
    localStorage.setItem('goatie_active_herd_u1', 'h-shared');
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1', 'h-shared'], writableHerdIds: ['u1', 'h-shared'] });
    await emitAndFlush(DB_USER);
    expect(get().activeHerdId).toBe('h-shared');

    localStorage.setItem('goatie_active_herd_u1', 'h-gone');
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1'], writableHerdIds: ['u1'] });
    await act(async () => {
      window.dispatchEvent(new Event('data-synced'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(get().activeHerdId).toBe('u1');
  });

  it('setActiveHerdId accepts member herds and rejects strangers', async () => {
    const get = setup();
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1', 'h-shared'], writableHerdIds: ['u1', 'h-shared'] });
    await emitAndFlush(DB_USER);
    act(() => {
      get().setActiveHerdId('h-shared');
    });
    expect(get().activeHerdId).toBe('h-shared');
    expect(localStorage.getItem('goatie_active_herd_u1')).toBe('h-shared');
    act(() => {
      get().setActiveHerdId('h-evil');
    });
    expect(get().activeHerdId).toBe('h-shared');
  });

  it('flags admins and refreshes herds on data-synced', async () => {
    const get = setup();
    authMocks.ensureUserRole.mockResolvedValue('admin');
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1'], writableHerdIds: ['u1'] });
    await emitAndFlush(DB_USER);
    expect(get().isAdmin).toBe(true);
    herdMocks.getHerdScope.mockResolvedValue({ herdIds: ['u1', 'h-new'], writableHerdIds: ['u1', 'h-new'] });
    await act(async () => {
      window.dispatchEvent(new Event('data-synced'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(get().herdIds).toEqual(['u1', 'h-new']);
  });

  it('exposes writable herds separately from visible herds (admin oversight)', async () => {
    const get = setup();
    // Admin sees another herd but has no membership row there: visible, not writable.
    herdMocks.getHerdScope.mockResolvedValue({
      herdIds: ['u1', 'herd-other'],
      writableHerdIds: ['u1'],
    });
    await emitAndFlush(DB_USER);
    expect(get().herdIds).toContain('herd-other');
    expect(get().writableHerdIds).toEqual(['u1']);
    expect(get().isWritable('herd-other')).toBe(false);
    expect(get().isWritable('u1')).toBe(true);
    expect(get().isWritable(null)).toBe(false);
    expect(get().readOnlyView).toBe(false);
    // Writes cannot target the view-only herd…
    act(() => {
      get().setActiveHerdId('herd-other');
    });
    expect(get().activeHerdId).toBe('u1');
    // …but viewing it flips the page into readonly mode.
    act(() => {
      get().setViewingHerdId('herd-other');
    });
    expect(get().viewingHerdId).toBe('herd-other');
    expect(get().readOnlyView).toBe(true);
    expect(localStorage.getItem('goatie_view_herd_u1')).toBe('herd-other');
    // Clearing the view exits readonly mode.
    act(() => {
      get().setViewingHerdId(null);
    });
    expect(get().readOnlyView).toBe(false);
    expect(localStorage.getItem('goatie_view_herd_u1')).toBeNull();
  });

  it('rejects viewing herds outside the visible set', async () => {
    const get = setup();
    await emitAndFlush(DB_USER);
    act(() => {
      get().setViewingHerdId('h-evil');
    });
    expect(get().viewingHerdId).toBeNull();
  });
});
