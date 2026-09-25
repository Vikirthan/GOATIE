import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import {
  AdminUser,
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

type Tab = 'herds' | 'users';

export const AdminPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('herds');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [profiles, setProfiles] = useState<{ userId: string; displayName: string }[]>([]);
  const [memberships, setMemberships] = useState<{ herd_id: string; user_id: string }[]>([]);
  const [goatCounts, setGoatCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // User management needs the server route (/api) — absent under `npm run
  // dev`. Herd assignment is direct-Supabase and works everywhere, so the
  // Herds tab stays usable and only the Users tab degrades.
  const [apiDown, setApiDown] = useState(false);

  // Create-user form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newHerd, setNewHerd] = useState('');

  // Per-herd assign picker: herdId -> userId
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  const emailById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.email);
    return m;
  }, [users]);

  // Display names resolve from profiles (direct Supabase — works even when
  // /api is down), falling back to the API user record, then to short ids.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.userId, p.displayName);
    for (const u of users) {
      if (!m.get(u.id) || m.get(u.id) === 'Farmer') m.set(u.id, u.displayName || u.email);
    }
    return m;
  }, [profiles, users]);

  const bannedIds = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) if (u.banned) s.add(u.id);
    return s;
  }, [users]);

  const herds = useMemo(() => {
    const ids = new Set<string>([
      ...memberships.map((m) => m.herd_id),
      ...Object.keys(goatCounts),
    ]);
    return [...ids];
  }, [memberships, goatCounts]);

  const herdLabel = useCallback((herdId: string): string => {
    const name = nameById.get(herdId);
    if (name && name !== 'Farmer') return `${name}'s herd`;
    const email = emailById.get(herdId);
    return email ? `${email}'s herd` : `Herd ${herdId.slice(0, 8)}…`;
  }, [nameById, emailById]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Load independently: herd data + profiles are direct-Supabase (work
      // everywhere); the users list needs /api (missing under plain vite dev).
      const [usersRes, overviewRes, profilesRes] = await Promise.allSettled([
        listAdminUsers(),
        getHerdOverview(),
        getProfiles(),
      ]);
      if (overviewRes.status === 'fulfilled') {
        setMemberships(overviewRes.value.memberships);
        setGoatCounts(overviewRes.value.goatCounts);
      } else {
        showToast('error', 'Failed to load herd data', overviewRes.reason instanceof Error ? overviewRes.reason.message : 'Unknown error');
      }
      if (usersRes.status === 'fulfilled') {
        setUsers(usersRes.value);
        setApiDown(false);
      } else {
        setApiDown(true);
      }
      if (profilesRes.status === 'fulfilled') {
        setProfiles(profilesRes.value);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = async (key: string, fn: () => Promise<void>, success: string) => {
    setBusy(key);
    try {
      await fn();
      showToast('success', success);
      await refresh();
    } catch (err) {
      showToast('error', 'Action failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || newPassword.length < 6) {
      showToast('error', 'Email and a 6+ character password are required');
      return;
    }
    await runAction(
      'create',
      () => createAdminUser({
        email: newEmail.trim(),
        password: newPassword,
        displayName: newName.trim() || newEmail.trim().split('@')[0],
        herdId: newHerd || undefined,
      }).then(() => undefined),
      'Login created',
    );
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewHerd('');
  };

  if (loading && users.length === 0 && herds.length === 0) {
    return <LoadingSpinner message="Loading admin data..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-0.5">
          View all herds (read-only) · assign logins to herds · manage users
        </p>
      </div>

      {apiDown && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              User management (create / reset / disable logins) needs the <code>/api</code> server
              route, which does not exist under plain <code>npm run dev</code> — test it with{' '}
              <code>npx vercel dev</code> or on the deployed URL. Herd viewing and assignment below
              work fine locally.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant={tab === 'herds' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('herds')}>
          Herds ({herds.length})
        </Button>
        <Button variant={tab === 'users' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('users')}>
          Users ({users.length})
        </Button>
      </div>

      {tab === 'herds' && (
        <div className="grid gap-4 md:grid-cols-2">
          {herds.map((herdId) => {
            const members = memberships.filter((m) => m.herd_id === herdId);
            const pick = assignPick[herdId] || '';
            // Assignable logins come from profiles (no /api needed); the API
            // users list only adds banned-state filtering when available.
            const assignable = profiles.filter(
              (p) => !bannedIds.has(p.userId) && !members.some((m) => m.user_id === p.userId),
            );
            return (
              <Card key={herdId}>
                <CardHeader>
                  <CardTitle className="text-lg">{herdLabel(herdId)}</CardTitle>
                  <CardDescription>
                    {goatCounts[herdId] ?? 0} goats · {members.length} farmer{members.length === 1 ? '' : 's'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-2">
                    {members.map((m) => {
                      const isAnchor = m.herd_id === m.user_id;
                      const name = nameById.get(m.user_id) || m.user_id.slice(0, 8);
                      const email = emailById.get(m.user_id);
                      return (
                        <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">
                            {name}
                            {isAnchor && <span className="text-muted-foreground"> (owner)</span>}
                            {email && email !== name && (
                              <span className="block text-xs text-muted-foreground truncate">{email}</span>
                            )}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isAnchor || busy === `unassign-${herdId}-${m.user_id}`}
                            title={isAnchor ? 'The herd owner cannot be removed from their own herd' : 'Remove from herd'}
                            onClick={() => void runAction(
                              `unassign-${herdId}-${m.user_id}`,
                              () => unassignHerd(herdId, m.user_id),
                              'Removed from herd',
                            )}
                          >
                            Remove
                          </Button>
                        </li>
                      );
                    })}
                    {members.length === 0 && (
                      <li className="text-sm text-muted-foreground">No farmers assigned.</li>
                    )}
                  </ul>
                  {assignable.length > 0 && (
                    <div className="flex gap-2 pt-1">
                      <div className="flex-1">
                        <Select
                          options={[
                            { value: '', label: 'Select login…' },
                            ...assignable.map((p) => ({ value: p.userId, label: p.displayName })),
                          ]}
                          value={pick}
                          onChange={(v) => setAssignPick((p) => ({ ...p, [herdId]: v }))}
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!pick || busy === `assign-${herdId}`}
                        onClick={() => void runAction(
                          `assign-${herdId}`,
                          () => assignHerd(herdId, pick).then(() => {
                            setAssignPick((p) => ({ ...p, [herdId]: '' }));
                          }),
                          'Login assigned to herd',
                        )}
                      >
                        Assign
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {herds.length === 0 && (
            <p className="text-sm text-muted-foreground">No herds found.</p>
          )}
        </div>
      )}

      {tab === 'users' && apiDown && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              User management is unavailable here because the <code>/api</code> server route does
              not exist under plain <code>npm run dev</code>. Run <code>npx vercel dev</code> (it
              serves the API routes with your local env) or test on the deployed URL.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === 'users' && !apiDown && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create login</CardTitle>
              <CardDescription>
                New logins get their own herd automatically — optionally assign them to an existing herd too.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleCreate(e)} className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="newName">Name</Label>
                  <Input id="newName" placeholder="Farmer name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="newEmail">Email *</Label>
                  <Input id="newEmail" type="email" placeholder="farmer@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="newPassword">Password * (min 6)</Label>
                  <Input id="newPassword" type="password" placeholder="Temporary password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="newHerd">Also assign to herd</Label>
                  <Select
                    options={[
                      { value: '', label: 'Own herd only' },
                      ...herds.map((h) => ({ value: h, label: herdLabel(h) })),
                    ]}
                    value={newHerd}
                    onChange={setNewHerd}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="primary" size="sm" isLoading={busy === 'create'}>
                    Create login
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">All logins</CardTitle>
              <CardDescription>Password resets send a Supabase recovery email. Banning keeps data but blocks sign-in.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {u.email}
                        {u.banned && <span className="ml-2 text-xs text-red-500 font-semibold">BANNED</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {u.displayName} · {u.herds.length} herd{u.herds.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        options={[
                          { value: 'farmer', label: 'Farmer' },
                          { value: 'admin', label: 'Admin' },
                        ]}
                        value={u.role}
                        onChange={(v) => {
                          if (v === u.role) return;
                          void runAction(
                            `role-${u.id}`,
                            () => setUserRole(u.id, v as 'admin' | 'farmer'),
                            `Role set to ${v}`,
                          );
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `reset-${u.id}`}
                        onClick={() => void runAction(`reset-${u.id}`, () => sendPasswordReset(u.id), 'Recovery email sent')}
                      >
                        Reset password
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `ban-${u.id}`}
                        onClick={() => void runAction(
                          `ban-${u.id}`,
                          () => setUserBanned(u.id, !u.banned),
                          u.banned ? 'Login re-enabled' : 'Login disabled',
                        )}
                      >
                        {u.banned ? 'Enable' : 'Disable'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
