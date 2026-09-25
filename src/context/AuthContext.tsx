import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppRole, User } from '@/types';
import { ensureUserProfile, ensureUserRole, onAuthChange } from '@/services/authService';
import { getHerdScope } from '@/services/supabaseService';
import { getProfiles } from '@/services/adminService';

interface AuthContextType {
  user: User | null;
  role: AppRole | null;
  isAdmin: boolean;
  loading: boolean;
  isAuthenticated: boolean;
  /** Every visible herd anchor (own id + member herds; admins see all herds). */
  herdIds: string[];
  /** Herds the login may write to (own id + member herds — never admin-only views). */
  writableHerdIds: string[];
  /** Herd new goats are registered into. Always writable. Defaults to own id. */
  activeHerdId: string | null;
  setActiveHerdId: (herdId: string) => void;
  /** Herd the home/list pages display. Null = all visible herds merged. */
  viewingHerdId: string | null;
  setViewingHerdId: (herdId: string | null) => void;
  /** True for a herd id the login may not write to. */
  isWritable: (herdId: string | null | undefined) => boolean;
  /** True when viewing a herd the login cannot write to (admin oversight). */
  readOnlyView: boolean;
  /** Display name by user id (profiles table) — for herd/member labels. */
  displayNameById: Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function storedHerdKey(userId: string): string {
  return `goatie_active_herd_${userId}`;
}

function storedViewKey(userId: string): string {
  return `goatie_view_herd_${userId}`;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [herdIds, setHerdIds] = useState<string[]>([]);
  const [writableHerdIds, setWritableHerdIds] = useState<string[]>([]);
  const [activeHerdId, setActiveHerdIdState] = useState<string | null>(null);
  const [viewingHerdId, setViewingHerdIdState] = useState<string | null>(null);
  const [displayNameById, setDisplayNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const herdIdsRef = useRef<string[]>([]);
  herdIdsRef.current = herdIds;
  const writableRef = useRef<string[]>([]);
  writableRef.current = writableHerdIds;

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthChange((currentUser) => {
      if (cancelled) return;
      setUser(currentUser);
      if (!currentUser) {
        setRole(null);
        setHerdIds([]);
        setWritableHerdIds([]);
        setActiveHerdIdState(null);
        setViewingHerdIdState(null);
        setDisplayNameById({});
        setLoading(false);
        return;
      }
      // Resolve role + herds in the background; user renders immediately.
      void (async () => {
        const [r, scope] = await Promise.all([
          ensureUserRole(currentUser.id),
          getHerdScope(currentUser.id),
        ]);
        if (cancelled) return;
        setRole(r);
        setHerdIds(scope.herdIds);
        setWritableHerdIds(scope.writableHerdIds);
        try {
          const stored = localStorage.getItem(storedHerdKey(currentUser.id));
          setActiveHerdIdState(
            stored && scope.writableHerdIds.includes(stored) ? stored : currentUser.id,
          );
          const storedView = localStorage.getItem(storedViewKey(currentUser.id));
          setViewingHerdIdState(
            storedView && scope.herdIds.includes(storedView) ? storedView : null,
          );
        } catch {
          setActiveHerdIdState(currentUser.id);
          setViewingHerdIdState(null);
        }
        setLoading(false);
        // Best-effort extras (never block auth): profile bootstrap + name map.
        void ensureUserProfile(currentUser.id, currentUser.displayName);
        try {
          const profiles = await getProfiles();
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const p of profiles) map[p.userId] = p.displayName;
          map[currentUser.id] = currentUser.displayName;
          setDisplayNameById(map);
        } catch {
          if (!cancelled) setDisplayNameById({ [currentUser.id]: currentUser.displayName });
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Refresh herd scope when data syncs (e.g. admin assigned a new herd —
  // membership cache + ids update without requiring re-login).
  useEffect(() => {
    if (!user) return;
    const refresh = async () => {
      const scope = await getHerdScope(user.id);
      setHerdIds(scope.herdIds);
      setWritableHerdIds(scope.writableHerdIds);
      setActiveHerdIdState((current) =>
        current && scope.writableHerdIds.includes(current) ? current : user.id,
      );
      setViewingHerdIdState((current) =>
        current && scope.herdIds.includes(current) ? current : null,
      );
    };
    window.addEventListener('data-synced', refresh);
    return () => window.removeEventListener('data-synced', refresh);
  }, [user]);

  // Writes only ever target writable herds — an admin viewing another herd
  // can look but cannot register into it.
  const setActiveHerdId = useCallback((herdId: string) => {
    if (!writableRef.current.includes(herdId)) return;
    setActiveHerdIdState(herdId);
    try {
      if (user) localStorage.setItem(storedHerdKey(user.id), herdId);
    } catch {
      // ignore
    }
  }, [user]);

  const setViewingHerdId = useCallback((herdId: string | null) => {
    if (herdId !== null && !herdIdsRef.current.includes(herdId)) return;
    setViewingHerdIdState(herdId);
    try {
      if (user) {
        if (herdId) localStorage.setItem(storedViewKey(user.id), herdId);
        else localStorage.removeItem(storedViewKey(user.id));
      }
    } catch {
      // ignore
    }
  }, [user]);

  const isWritable = useCallback((herdId: string | null | undefined): boolean => {
    if (!herdId) return false;
    return writableRef.current.includes(herdId);
  }, []);

  const readOnlyView = viewingHerdId !== null && !writableRef.current.includes(viewingHerdId);

  const value: AuthContextType = {
    user,
    role,
    isAdmin: role === 'admin',
    loading,
    isAuthenticated: !!user,
    herdIds,
    writableHerdIds,
    activeHerdId,
    setActiveHerdId,
    viewingHerdId,
    setViewingHerdId,
    isWritable,
    readOnlyView,
    displayNameById,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
