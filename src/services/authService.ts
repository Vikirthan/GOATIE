import { AppRole, User } from '@/types';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const LEGACY_DEMO_KEY = 'goatie_logged_in_user';

/** Remove any stale demo session so old devices can't stay on RKT/VIKI ids. */
function clearLegacyDemoSession(): void {
  try {
    localStorage.removeItem(LEGACY_DEMO_KEY);
  } catch {
    // ignore (SSR / private mode)
  }
}

function mapSupabaseUser(u: SupabaseUser, fallbackName?: string): User {
  return {
    id: u.id,
    email: u.email || '',
    displayName:
      u.user_metadata?.display_name || fallbackName || u.email?.split('@')[0] || 'User',
    role: 'farmer',
    createdAt: new Date(u.created_at),
    updatedAt: new Date(u.updated_at || u.created_at),
  };
}

type AuthCallback = (user: User | null) => void;
const authListeners = new Set<AuthCallback>();

function notifyAuthListeners(user: User | null) {
  authListeners.forEach((listener) => {
    try {
      listener(user);
    } catch (e) {
      console.error('Error notifying auth listener:', e);
    }
  });
}

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<User> {
  clearLegacyDemoSession();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Registration failed.');
  const user = mapSupabaseUser(data.user, displayName);
  notifyAuthListeners(user);
  return user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  clearLegacyDemoSession();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('User not found.');
  const user = mapSupabaseUser(data.user);
  notifyAuthListeners(user);
  return user;
}

export async function logout(): Promise<void> {
  clearLegacyDemoSession();
  notifyAuthListeners(null);
  await supabase.auth.signOut();
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  authListeners.add(callback);
  clearLegacyDemoSession();

  // Initial fetch of current user — read the locally cached session (no network
  // round-trip) so the app isn't blocked waiting on a server call before it can
  // render. Supabase verifies/refreshes the token in the background as needed,
  // and onAuthStateChange below will correct `callback` if the session turns out
  // to be invalid.
  supabase.auth.getSession().then(({ data: { session } }) => {
    const user = session?.user;
    if (user) {
      callback(mapSupabaseUser(user));
    } else {
      callback(null);
    }
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      callback(mapSupabaseUser(session.user));
    } else {
      callback(null);
    }
  });

  return () => {
    authListeners.delete(callback);
    subscription.unsubscribe();
  };
}

export function getAuthToken(): Promise<string | null> {
  return supabase.auth.getSession().then(({ data: { session } }) => session?.access_token || null);
}

// ─── RBAC: role comes from the user_roles table (server-checked by RLS), ────
// never from user_metadata (users can edit their own metadata). Pre-migration
// or on error this fails open as 'farmer' — never as admin.

// First-login bootstrap: insert own row as farmer (RLS only permits
// self-insert with role='farmer'; promotion is admin-only via /api/admin).
export async function ensureUserRole(userId: string): Promise<AppRole> {
  try {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data.role === 'admin' ? 'admin' : 'farmer';
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role: 'farmer' });
    if (error) return 'farmer';
    return 'farmer';
  } catch {
    return 'farmer';
  }
}

// Display-name mirror for UI labels (herd names, member lists). The profiles
// table is readable by any login, unlike auth.users. Best-effort: missing
// table (pre-migration) or errors are silently ignored.
export async function ensureUserProfile(userId: string, displayName: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .upsert(
        { user_id: userId, display_name: displayName?.trim() || 'Farmer' },
        { onConflict: 'user_id' },
      );
  } catch {
    // ignore — labels fall back to ids
  }
}
