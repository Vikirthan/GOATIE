import { createClient } from '@supabase/supabase-js';
import { buildGoatRow, buildWeightRow, buildDewormRow, buildVaccRow, ReconRow } from './rows.js';

const SHEETS_WEBAPP_URL = process.env.GOOGLE_SHEETS_BACKUP_WEBAPP_URL || '';
const SHEETS_SECRET = process.env.GOOGLE_SHEETS_BACKUP_SECRET || '';
const PUSH_CHUNK = 500;

// Normalized compare — the core fix for "recon doesn't do a good job".
// Sheets returns Dates as serials/strings and numbers as numbers-or-strings
// while the app sends YYYY-MM-DD strings + JSON numbers. Strict
// JSON.stringify compare flagged every row as changed on every run.
function normVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().split('T')[0];
  }
  if (typeof v === 'string') {
    const t = v.trim();
    // Sheets Date objects serialize through JSON as ISO strings — compare by day.
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t.slice(0, 10);
    return t;
  }
  return String(v).trim();
}

function rowsEqual(a: ReconRow, b: ReconRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'id'));
  for (const k of keys) {
    if (normVal(a[k]) !== normVal(b[k])) return false;
  }
  return true;
}

// Duplicated from src/services/supabaseService.ts (kept minimal here) — that file also
// imports browser-only modules (import.meta.env, IndexedDB) that don't run in this
// Node serverless function.
function snakeToCamel(obj: any): any {
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc: any, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      acc[camelKey] = snakeToCamel(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase admin credentials are not configured');
  return createClient(url, key);
}

async function callSheet(action: 'read', sheet: string): Promise<ReconRow[]>;
async function callSheet(
  action: 'reconcile',
  sheet: string,
  payload: { toAdd: ReconRow[]; toUpdate: ReconRow[]; toDeleteIds: string[] }
): Promise<{ added: number; updated: number; deleted: number }>;
async function callSheet(action: 'read' | 'reconcile', sheet: string, payload?: any): Promise<any> {
  if (!SHEETS_WEBAPP_URL) throw new Error('GOOGLE_SHEETS_BACKUP_WEBAPP_URL is not configured');

  let data: any;
  if (action === 'read') {
    const secretQs = SHEETS_SECRET ? `&secret=${encodeURIComponent(SHEETS_SECRET)}` : '';
    const res = await fetch(
      `${SHEETS_WEBAPP_URL}?action=read&sheet=${encodeURIComponent(sheet)}${secretQs}&_t=${Date.now()}`,
    );
    if (!res.ok) throw new Error(`Failed to read sheet "${sheet}": ${res.statusText}`);
    data = await res.json();
  } else {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, sheet, secret: SHEETS_SECRET || undefined, ...payload }),
    });
    if (!res.ok) throw new Error(`Failed to reconcile sheet "${sheet}": ${res.statusText}`);
    data = await res.json();
  }
  if (data && data.error) throw new Error(`Apps Script error on "${sheet}": ${data.error}`);
  return data;
}

/** New-style direct push (same protocol the browser uses): upsert + prune/erase. */
async function pushTab(
  tab: string,
  rows: ReconRow[],
  opts: { allIds?: string[]; prune?: boolean; erase?: boolean },
): Promise<{ inserted: number; updated: number; skipped: number; deleted: number }> {
  if (!SHEETS_WEBAPP_URL) throw new Error('GOOGLE_SHEETS_BACKUP_WEBAPP_URL is not configured');
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: SHEETS_SECRET || undefined,
      tab,
      rows,
      allIds: opts.allIds ?? null,
      prune: !!opts.prune,
      erase: !!opts.erase,
    }),
  });
  if (!res.ok) throw new Error(`Failed to push tab "${tab}": ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(`Apps Script error on "${tab}": ${data.error}`);
  return data;
}

export function currentMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Monthly rewrite runs on the 1st (or FORCE_FULL_REWRITE=1). Shared by the
 *  push route and the sync-state bookkeeping so both agree. */
export function isFullRewriteRun(d = new Date()): boolean {
  return process.env.FORCE_FULL_REWRITE === '1' || d.getDate() === 1;
}

/** Read all 4 tabs (restore path) through the secret-authenticated endpoint. */
export async function readAllTabs(): Promise<Record<string, ReconRow[]>> {
  const names = ['Goats Data', 'Monthly Weights', 'Deworming', 'Vaccination'];
  const out: Record<string, ReconRow[]> = {};
  for (const name of names) {
    out[name] = await callSheet('read', name);
  }
  return out;
}

export function computeReconOps(current: ReconRow[], existing: ReconRow[]) {
  const currentById = new Map(current.map((r) => [String(r.id), r]));
  const existingById = new Map(existing.map((r) => [String(r.id), r]));

  const toAdd: ReconRow[] = [];
  const toUpdate: ReconRow[] = [];
  const toDeleteIds: string[] = [];

  for (const [id, row] of currentById) {
    const prior = existingById.get(id);
    if (!prior) {
      toAdd.push(row);
    } else if (!rowsEqual(prior, row)) {
      toUpdate.push(row);
    }
  }
  for (const id of existingById.keys()) {
    if (!currentById.has(id)) toDeleteIds.push(id);
  }

  return { toAdd, toUpdate, toDeleteIds };
}

export interface ReconSummary {
  tab: string;
  added: number;
  updated: number;
  deleted: number;
}

export async function reconcileAllTabs(): Promise<{ summary: ReconSummary[]; fullRewrite: boolean }> {
  const db = supabaseAdmin();

  const [goatsRes, weightsRes, dewormRes, vaccRes, salesRes] = await Promise.all([
    db.from('goats').select('*'),
    db.from('weights').select('*'),
    db.from('deworming').select('*'),
    db.from('vaccinations').select('*'),
    db.from('sales').select('*'),
  ]);
  for (const res of [goatsRes, weightsRes, dewormRes, vaccRes, salesRes]) {
    if (res.error) throw res.error;
  }

  const goats = (goatsRes.data || []).map(snakeToCamel);
  const weights = (weightsRes.data || []).map(snakeToCamel);
  const dewormings = (dewormRes.data || []).map(snakeToCamel);
  const vaccinations = (vaccRes.data || []).map(snakeToCamel);
  const sales = (salesRes.data || []).map(snakeToCamel);

  const goatById = new Map(goats.map((g: any) => [g.id, g]));
  const saleByGoatId = new Map(sales.map((s: any) => [s.goatId, s]));
  const vaccSet = new Set(vaccinations.map((v: any) => v.goatId));
  const dewormSet = new Set(dewormings.map((d: any) => d.goatId));
  const earTag = (goatId: string) => goatById.get(goatId)?.earTagNumber ?? goatId;

  const tabs: { name: string; rows: ReconRow[] }[] = [
    {
      name: 'Goats Data',
      rows: goats.map((g: any) =>
        buildGoatRow(g, saleByGoatId.get(g.id) ?? g.saleInfo, vaccSet.has(g.id), dewormSet.has(g.id))
      ),
    },
    {
      name: 'Monthly Weights',
      rows: weights
        .filter((w: any) => w.isRecorded && w.weight > 0)
        .map((w: any) => buildWeightRow(w, earTag(w.goatId))),
    },
    {
      name: 'Deworming',
      rows: dewormings.map((d: any) => buildDewormRow(d, earTag(d.goatId))),
    },
    {
      name: 'Vaccination',
      rows: vaccinations.map((v: any) => buildVaccRow(v, earTag(v.goatId))),
    },
  ];

  // Monthly full rewrite on the 1st (or FORCE_FULL_REWRITE=1): erase each tab
  // and re-fetch as new from current DB state. Otherwise daily verify:
  // diff with normalized compare, deletes propagate the same day.
  const fullRewrite = isFullRewriteRun();

  const summaries: ReconSummary[] = [];
  // Daily verify: read all tabs up front in parallel (reads don't lock), then
  // reconcile sequentially — concurrent writes trip the script's busy lock.
  // This keeps first pushes inside serverless time limits.
  const existingByTab = fullRewrite
    ? []
    : await Promise.all(tabs.map((tab) => callSheet('read', tab.name)));
  for (let ti = 0; ti < tabs.length; ti++) {
    const tab = tabs[ti];
    if (fullRewrite) {
      let added = 0;
      let deleted = 0;
      if (tab.rows.length === 0) {
        const r = await pushTab(tab.name, [], { allIds: [], prune: true, erase: true });
        deleted = r.deleted ?? 0;
      } else {
        for (let i = 0; i < tab.rows.length; i += PUSH_CHUNK) {
          const chunk = tab.rows.slice(i, i + PUSH_CHUNK);
          const first = i === 0;
          // erase on the first chunk clears stale rows; later chunks append.
          // No prune needed — the sheet was just cleared, so it equals DB state.
          const r = await pushTab(tab.name, chunk, { erase: first });
          added += r.inserted ?? 0;
          deleted += r.deleted ?? 0;
        }
      }
      summaries.push({ tab: tab.name, added, updated: 0, deleted });
      continue;
    }

    const existing = existingByTab[ti] as ReconRow[];
    const { toAdd, toUpdate, toDeleteIds } = computeReconOps(tab.rows, existing);
    if (toAdd.length || toUpdate.length || toDeleteIds.length) {
      await callSheet('reconcile', tab.name, { toAdd, toUpdate, toDeleteIds });
    }
    summaries.push({ tab: tab.name, added: toAdd.length, updated: toUpdate.length, deleted: toDeleteIds.length });
  }
  return { summary: summaries, fullRewrite };
}
