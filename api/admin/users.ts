import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Admin user management. Everything here needs the service-role key, so it
// lives server-side behind this same-origin route. The browser sends the
// caller's Supabase access token as Bearer; this route verifies the caller
// is an admin (user_roles table) before touching the Auth Admin API.
//
//   GET  ?view=users → [{ id, email, displayName, role, banned, herds }]
//   POST { action: 'create', email, password, displayName, herdId? }
//        → creates login (email pre-confirmed), seeds role + self-membership,
//          optionally assigns to an existing herd in the same call.
//   POST { action: 'reset', userId } → sends Supabase recovery email.
//   POST { action: 'ban' | 'unban', userId } → disables / re-enables login.
//   POST { action: 'setRole', userId, role } → farmer <-> admin.
//
// There is deliberately NO delete: goats.farmer_id references auth.users with
// cascade, so deleting a login would wipe its herd. Ban instead.

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase admin credentials are not configured');
  return createClient(url, key);
}

function anonClient() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase client credentials are not configured');
  return createClient(url, key);
}

function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

async function requireAdmin(req: VercelRequest): Promise<{ id: string; email: string } | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  try {
    const { data: { user }, error } = await anonClient().auth.getUser(token);
    if (error || !user) return null;
    const { data: role } = await serviceClient()
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!role || (role as { role: string }).role !== 'admin') return null;
    return { id: user.id, email: user.email || '' };
  } catch {
    return null;
  }
}

async function listUsers(res: VercelResponse) {
  const db = serviceClient();
  const { data: listed, error } = await db.auth.admin.listUsers();
  if (error) throw error;

  const [rolesRes, membersRes] = await Promise.all([
    db.from('user_roles').select('user_id,role'),
    db.from('herd_members').select('herd_id,user_id'),
  ]);
  const roles = new Map<string, string>(
    ((rolesRes.data ?? []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role]),
  );
  const herdsByUser = new Map<string, string[]>();
  for (const m of (membersRes.data ?? []) as { herd_id: string; user_id: string }[]) {
    const arr = herdsByUser.get(m.user_id) ?? [];
    arr.push(m.herd_id);
    herdsByUser.set(m.user_id, arr);
  }

  res.status(200).json({
    ok: true,
    users: (listed?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email || '',
      displayName: (u.user_metadata as Record<string, unknown> | null)?.display_name || (u.email || '').split('@')[0],
      role: roles.get(u.id) ?? 'farmer',
      banned: !!u.banned_until && new Date(u.banned_until).getTime() > Date.now(),
      herds: herdsByUser.get(u.id) ?? [],
    })),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req);
  if (!admin) {
    res.status(403).json({ ok: false, error: 'Admin access required' });
    return;
  }

  try {
    if (req.method === 'GET') {
      if (req.query.view === 'users' || !req.query.view) {
        await listUsers(res);
        return;
      }
      res.status(400).json({ ok: false, error: 'Unknown view' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body.action || '');
    const db = serviceClient();

    if (action === 'create') {
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const displayName = String(body.displayName || '').trim() || email.split('@')[0];
      const herdId = body.herdId ? String(body.herdId) : null;
      if (!email || password.length < 6) {
        res.status(400).json({ ok: false, error: 'Email and a 6+ character password are required' });
        return;
      }
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (error) throw error;
      const newId = data.user.id;
      await db.from('user_roles').upsert({ user_id: newId, role: 'farmer' }, { onConflict: 'user_id' });
      // Self-membership so the new login owns a herd; plus optional assignment.
      await db.from('herd_members').upsert({ herd_id: newId, user_id: newId }, { onConflict: 'herd_id,user_id' });
      if (herdId && herdId !== newId) {
        const { error: mErr } = await db
          .from('herd_members')
          .upsert({ herd_id: herdId, user_id: newId }, { onConflict: 'herd_id,user_id' });
        if (mErr) throw mErr;
      }
      res.status(200).json({ ok: true, userId: newId });
      return;
    }

    if (action === 'reset') {
      const userId = String(body.userId || '');
      if (!userId) {
        res.status(400).json({ ok: false, error: 'userId is required' });
        return;
      }
      const { data: { user }, error: getErr } = await db.auth.admin.getUserById(userId);
      if (getErr || !user?.email) throw getErr || new Error('User has no email');
      // Sends the Supabase recovery email (uses the project's email settings).
      const siteUrl = process.env.SITE_URL || undefined;
      const { error } = await anonClient().auth.resetPasswordForEmail(
        user.email,
        siteUrl ? { redirectTo: siteUrl } : undefined,
      );
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'ban' || action === 'unban') {
      const userId = String(body.userId || '');
      if (!userId) {
        res.status(400).json({ ok: false, error: 'userId is required' });
        return;
      }
      if (userId === admin.id) {
        res.status(400).json({ ok: false, error: 'You cannot disable your own admin login' });
        return;
      }
      const { error } = await db.auth.admin.updateUserById(userId, {
        ban_duration: action === 'ban' ? '876000h' : 'none',
      });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'setRole') {
      const userId = String(body.userId || '');
      const role = String(body.role || '');
      if (!userId || (role !== 'admin' && role !== 'farmer')) {
        res.status(400).json({ ok: false, error: 'userId and role (admin|farmer) are required' });
        return;
      }
      if (userId === admin.id && role !== 'admin') {
        res.status(400).json({ ok: false, error: 'You cannot demote your own admin login' });
        return;
      }
      const { error } = await db
        .from('user_roles')
        .upsert({ user_id: userId, role }, { onConflict: 'user_id' });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err: unknown) {
    console.error('Admin API failed:', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Admin action failed' });
  }
}
