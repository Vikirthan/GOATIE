import { supabase } from '@/lib/supabase';
import { getAuthToken } from '@/services/authService';

/**
 * Admin client — user management goes through the server route (service-role),
 * herd assign/unassign goes direct (RLS permits admins only).
 */

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'farmer';
  banned: boolean;
  herds: string[];
}

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new Error('You must be signed in');
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error(
      'Admin API is unreachable. Under `npm run dev` the /api routes do not exist — test user management with `npx vercel dev` or on the deployed URL.',
    );
  }
  const text = await res.text();
  let data: (T & { ok: boolean; error?: string }) | null = null;
  try {
    data = JSON.parse(text) as T & { ok: boolean; error?: string };
  } catch {
    throw new Error(
      'Admin API did not return JSON (got the app shell instead). Under `npm run dev` the /api routes do not exist — test user management with `npx vercel dev` or on the deployed URL.',
    );
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `Server returned HTTP ${res.status}`);
  return data;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const data = await callApi<{ ok: boolean; users: AdminUser[] }>('/api/admin/users?view=users');
  return data.users;
}

export async function createAdminUser(input: {
  email: string;
  password: string;
  displayName: string;
  herdId?: string;
}): Promise<string> {
  const data = await callApi<{ ok: boolean; userId: string }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...input }),
  });
  return data.userId;
}

export async function sendPasswordReset(userId: string): Promise<void> {
  await callApi('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset', userId }),
  });
}

export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  await callApi('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ action: banned ? 'ban' : 'unban', userId }),
  });
}

export async function setUserRole(userId: string, role: 'admin' | 'farmer'): Promise<void> {
  await callApi('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ action: 'setRole', userId, role }),
  });
}

// ─── Herds (direct Supabase — RLS: admin select all, admin-only write) ───────

export interface ProfileRow {
  userId: string;
  displayName: string;
}

/** Display names for every login (readable by any authenticated user). */
export async function getProfiles(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('user_id,display_name');
  if (error) throw error;
  return ((data ?? []) as { user_id: string; display_name: string }[]).map((p) => ({
    userId: p.user_id,
    displayName: p.display_name || 'Farmer',
  }));
}

export interface HerdMembershipRow {
  herd_id: string;
  user_id: string;
}

/** All memberships + goat counts per herd anchor (admin sees everything). */
export async function getHerdOverview(): Promise<{
  memberships: HerdMembershipRow[];
  goatCounts: Record<string, number>;
}> {
  const [{ data: members, error: mErr }, { data: goats, error: gErr }] = await Promise.all([
    supabase.from('herd_members').select('herd_id,user_id'),
    supabase.from('goats').select('id,farmer_id'),
  ]);
  if (mErr) throw mErr;
  if (gErr) throw gErr;
  const goatCounts: Record<string, number> = {};
  for (const g of (goats ?? []) as { id: string; farmer_id: string }[]) {
    goatCounts[g.farmer_id] = (goatCounts[g.farmer_id] ?? 0) + 1;
  }
  return {
    memberships: (members ?? []) as HerdMembershipRow[],
    goatCounts,
  };
}

/** Assign a login to a herd (admin only, enforced by RLS). */
export async function assignHerd(herdId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('herd_members')
    .upsert({ herd_id: herdId, user_id: userId }, { onConflict: 'herd_id,user_id' });
  if (error) throw error;
}

/** Remove a login from a herd (admin only, enforced by RLS). */
export async function unassignHerd(herdId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('herd_members')
    .delete()
    .eq('herd_id', herdId)
    .eq('user_id', userId);
  if (error) throw error;
}
