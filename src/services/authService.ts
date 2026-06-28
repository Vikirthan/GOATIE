import { supabase } from '@/lib/supabase';
import { User } from '@/types';

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
  if (!data.user) throw new Error('Failed to register user');

  const user: User = {
    id: data.user.id,
    email: data.user.email || '',
    displayName: displayName,
    role: 'farmer',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Upsert user profile to public.profiles table (fallback if DB trigger is delayed/disabled)
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    updated_at: new Date(),
  });

  if (profileError) {
    console.warn('Profile sync warning:', profileError.message);
  }

  return user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  if (email.trim().toUpperCase() === DEMO_USERNAME && password === DEMO_PASSWORD) {
    localStorage.setItem('goatie_logged_in_user', JSON.stringify(DEMO_USER));
    notifyAuthListeners(DEMO_USER);
    return DEMO_USER;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  if (!data.user) throw new Error('User login failed');

  const user = await getUserFromSupabase(data.user.id);
  notifyAuthListeners(user);
  return user;
}

export async function loginWithGoogle(): Promise<User> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
  });

  if (error) throw error;
  throw new Error('Google Sign-In redirected. Session will load automatically.');
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

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) return null;

  try {
    return await getUserFromSupabase(session.user.id);
  } catch (e) {
    console.error('Error fetching current user profile:', e);
    return null;
  }
}

export async function getUserFromSupabase(userId: string): Promise<User> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'User profile not found in Supabase database');
  }

  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name || 'Farmer',
    role: data.role || 'farmer',
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
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
  } else {
    // If not demo user, fetch session state to notify listeners
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (localStorage.getItem('goatie_logged_in_user')) return;
      if (session?.user) {
        getUserFromSupabase(session.user.id)
          .then((user) => callback(user))
          .catch(() => callback(null));
      } else {
        callback(null);
      }
    });
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (localStorage.getItem('goatie_logged_in_user')) return; // Ignore if demo user is active

    if (session?.user) {
      try {
        const user = await getUserFromSupabase(session.user.id);
        callback(user);
      } catch (error) {
        console.error('Error fetching user data on auth change:', error);
        callback(null);
      }
    } else {
      callback(null);
    }
  });

  return () => {
    authListeners.delete(callback);
    subscription.unsubscribe();
  };
}

export async function getAuthToken(): Promise<string | null> {
  if (localStorage.getItem('goatie_logged_in_user')) {
    return 'demo_token';
  }
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}
