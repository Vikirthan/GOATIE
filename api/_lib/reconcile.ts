import { createClient } from '@supabase/supabase-js';
import { buildGoatRow, buildWeightRow, buildDewormRow, buildVaccRow, ReconRow } from '../../src/utils/reconRows';

const SHEETS_WEBAPP_URL = process.env.GOOGLE_SHEETS_BACKUP_WEBAPP_URL || '';

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
    const res = await fetch(`${SHEETS_WEBAPP_URL}?action=read&sheet=${encodeURIComponent(sheet)}&_t=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to read sheet "${sheet}": ${res.statusText}`);
    data = await res.json();
  } else {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, sheet, ...payload }),
    });
    if (!res.ok) throw new Error(`Failed to reconcile sheet "${sheet}": ${res.statusText}`);
    data = await res.json();
  }
  if (data && data.error) throw new Error(`Apps Script error on "${sheet}": ${data.error}`);
  return data;
}

export function computeReconOps(current: ReconRow[], existing: ReconRow[]) {
  const currentById = new Map(current.map((r) => [r.id, r]));
  const existingById = new Map(existing.map((r) => [r.id, r]));

  const toAdd: ReconRow[] = [];
  const toUpdate: ReconRow[] = [];
  const toDeleteIds: string[] = [];

  for (const [id, row] of currentById) {
    const prior = existingById.get(id);
    if (!prior) {
      toAdd.push(row);
    } else if (JSON.stringify(prior) !== JSON.stringify(row)) {
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

export async function reconcileAllTabs(): Promise<ReconSummary[]> {
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

  const summaries: ReconSummary[] = [];
  for (const tab of tabs) {
    const existing = await callSheet('read', tab.name);
    const { toAdd, toUpdate, toDeleteIds } = computeReconOps(tab.rows, existing);
    if (toAdd.length || toUpdate.length || toDeleteIds.length) {
      await callSheet('reconcile', tab.name, { toAdd, toUpdate, toDeleteIds });
    }
    summaries.push({ tab: tab.name, added: toAdd.length, updated: toUpdate.length, deleted: toDeleteIds.length });
  }
  return summaries;
}
