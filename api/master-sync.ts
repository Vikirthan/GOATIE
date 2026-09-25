import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { reconcileAllTabs, readAllTabs, currentMonthKey } from './_lib/reconcile.js';

// Master Sheets sync endpoint. All secrets stay server-side (plain env, never
// VITE_-prefixed): the browser calls this same-origin route, and only this
// route talks to Supabase (service role) and the Apps Script (secret).
//
//   POST (or GET ?run=1 with CRON_SECRET bearer) → push current DB state to
//     the ONE master spreadsheet (daily verify; erase + re-fetch on the 1st).
//   GET ?view=status (default) → { lastSyncAt, rewriteMonth, lastResult }.
//   GET ?view=tabs → all 4 tabs (restore path; the app upserts them by id).
//
// NOTE: POST is intentionally unauthenticated. The app now uses real Supabase
// Auth (per-farmer RLS on all tables), but session auth on this route would
// still lock out valid edge cases (expired session on launch sync), and the
// abuse surface stays narrow: anyone can only *trigger* an idempotent sync of
// our own data to our own sheet — no data injection. Harden later with Vercel
// firewall/KV rate limits if it ever matters.

const SHEETS_CONFIGURED = !!(
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.GOOGLE_SHEETS_BACKUP_WEBAPP_URL &&
  process.env.GOOGLE_SHEETS_BACKUP_SECRET
);

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase admin credentials are not configured');
  return createClient(url, key);
}

function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

interface SyncState {
  lastSyncAt: number | null;
  rewriteMonth: string | null;
  lastResult: unknown;
}

async function readState(): Promise<SyncState> {
  const empty: SyncState = { lastSyncAt: null, rewriteMonth: null, lastResult: null };
  try {
    const db = serviceClient();
    const { data, error } = await db.from('master_sync_state').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return empty;
    return {
      lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at).getTime() : null,
      rewriteMonth: data.rewrite_month ?? null,
      lastResult: data.last_result ?? null,
    };
  } catch {
    return empty;
  }
}

async function doPush(res: VercelResponse) {
  if (!SHEETS_CONFIGURED) {
    res.status(500).json({
      ok: false,
      error:
        'Master Sheets not configured on the server — set SUPABASE_SERVICE_ROLE_KEY, ' +
        'GOOGLE_SHEETS_BACKUP_WEBAPP_URL and GOOGLE_SHEETS_BACKUP_SECRET in Vercel.',
    });
    return;
  }
  try {
    const { summary, fullRewrite } = await reconcileAllTabs();
    const ranAt = new Date();
    // Best-effort bookkeeping: the sheet push above is the source of truth;
    // a state-write failure must not fail the sync itself.
    try {
      const db = serviceClient();
      const prev = await readState();
      await db.from('master_sync_state').upsert(
        {
          id: 1,
          last_sync_at: ranAt.toISOString(),
          rewrite_month: fullRewrite ? currentMonthKey(ranAt) : prev.rewriteMonth,
          last_result: summary,
        },
        { onConflict: 'id' },
      );
    } catch (stateErr) {
      console.error('master_sync_state write failed (sync itself succeeded):', stateErr);
    }
    res.status(200).json({ ok: true, summary, fullRewrite, ranAt: ranAt.getTime() });
  } catch (err: unknown) {
    console.error('Master Sheets push failed:', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    await doPush(res);
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  // Future closed-app cron: GET ?run=1 with CRON_SECRET bearer (Vercel sends it
  // automatically for scheduled invocations). Dormant until a crons entry exists.
  if (req.query.run === '1') {
    const token = getBearerToken(req);
    if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    await doPush(res);
    return;
  }

  if (req.query.view === 'tabs') {
    if (!SHEETS_CONFIGURED) {
      res.status(500).json({ ok: false, error: 'Master Sheets not configured on the server.' });
      return;
    }
    try {
      const tabs = await readAllTabs();
      res.status(200).json({ ok: true, tabs });
    } catch (err: unknown) {
      console.error('Master Sheets read failed:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Read failed' });
    }
    return;
  }

  // Default: ?view=status — needs the state table (see master-sync README SQL).
  const state = await readState();
  res.status(200).json({ ok: true, ...state });
}
