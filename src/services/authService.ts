import { User } from '@/types';
import { supabase } from '@/lib/supabase';

// Hardcoded credentials for demo
const DEMO_USERNAME = 'RKT';
const DEMO_PASSWORD = 'Rkte4eraja';

const DEMO_USER: User = {
  id: 'RKT',
  email: 'rkt@goatie.com',
  displayName: 'RKT',
  role: 'farmer',
  createdAt: new Date('2026-06-27T00:00:00.000Z'),
  updatedAt: new Date('2026-06-27T00:00:00.000Z'),
};

const VIKI_USER: User = {
  id: 'VIKI',
  email: 'viki@goatie.com',
  displayName: 'Viki',
  role: 'farmer',
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
};

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

// Check if using demo credentials
export function isDemoMode(): boolean {
  return localStorage.getItem('goatie_logged_in_user') !== null;
}

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<User> {
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
  return {
    id: data.user.id,
    email: data.user.email || '',
    displayName,
    role: 'farmer',
    createdAt: new Date(data.user.created_at),
    updatedAt: new Date(data.user.updated_at || data.user.created_at),
  };
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const normalizedEmail = email.trim().toUpperCase();
  if (normalizedEmail === DEMO_USERNAME && password === DEMO_PASSWORD) {
    localStorage.setItem('goatie_logged_in_user', JSON.stringify(DEMO_USER));
    notifyAuthListeners(DEMO_USER);
    return DEMO_USER;
  }
  if (normalizedEmail === 'VIKI' && password === 'Viki') {
    localStorage.setItem('goatie_logged_in_user', JSON.stringify(VIKI_USER));
    notifyAuthListeners(VIKI_USER);
    return VIKI_USER;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('User not found.');
  const user: User = {
    id: data.user.id,
    email: data.user.email || '',
    displayName: data.user.user_metadata?.display_name || data.user.email?.split('@')[0] || 'User',
    role: 'farmer',
    createdAt: new Date(data.user.created_at),
    updatedAt: new Date(data.user.updated_at || data.user.created_at),
  };
  notifyAuthListeners(user);
  return user;
}

export async function logout(): Promise<void> {
  localStorage.removeItem('goatie_logged_in_user');
  notifyAuthListeners(null);
  await supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<User | null> {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  if (cachedDemoUser) {
    try {
      const user = JSON.parse(cachedDemoUser) as User;
      user.createdAt = new Date(user.createdAt);
      user.updatedAt = new Date(user.updatedAt);
      return user;
    } catch (e) {
      console.error('Error parsing cached demo user:', e);
    }
  }

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return {
    id: user.id,
    email: user.email || '',
    displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
    role: 'farmer',
    createdAt: new Date(user.created_at),
    updatedAt: new Date(user.updated_at || user.created_at),
  };
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  authListeners.add(callback);

  // Invoke with current cached state immediately to avoid initial redirect
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  if (cachedDemoUser) {
    try {
      const user = JSON.parse(cachedDemoUser) as User;
      user.createdAt = new Date(user.createdAt);
      user.updatedAt = new Date(user.updatedAt);
      callback(user);
    } catch (e) {
      console.error('Error parsing cached demo user:', e);
      callback(null);
    }

    return () => {
      authListeners.delete(callback);
    };
  }

  // Initial fetch of current user — read the locally cached session (no network
  // round-trip) so the app isn't blocked waiting on a server call before it can
  // render. Supabase verifies/refreshes the token in the background as needed,
  // and onAuthStateChange below will correct `callback` if the session turns out
  // to be invalid.
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (localStorage.getItem('goatie_logged_in_user')) return;
    const user = session?.user;
    if (user) {
      callback({
        id: user.id,
        email: user.email || '',
        displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
        role: 'farmer',
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at || user.created_at),
      });
    } else {
      callback(null);
    }
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (localStorage.getItem('goatie_logged_in_user')) return;
    if (session?.user) {
      callback({
        id: session.user.id,
        email: session.user.email || '',
        displayName: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User',
        role: 'farmer',
        createdAt: new Date(session.user.created_at),
        updatedAt: new Date(session.user.updated_at || session.user.created_at),
      });
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
  if (localStorage.getItem('goatie_logged_in_user')) {
    return Promise.resolve('demo_token');
  }
  return supabase.auth.getSession().then(({ data: { session } }) => session?.access_token || null);
}
