import { supabase } from '@/lib/supabase';
import { camelToSnake } from '@/services/supabaseService';
import type { ReconRow } from '@/utils/reconRows';

/**
 * Master Sheets sync — server-side transport.
 *
 * The browser talks only to the same-origin `/api/master-sync` route. All
 * secrets (Supabase service-role key, Apps Script URL + secret) live in plain
 * Vercel env vars — nothing sheet-related in the app, no localStorage config,
 * nothing `VITE_`-prefixed that isn't already public.
 *
 *   - `triggerMasterSync()` — push current DB state to the ONE master
 *     spreadsheet (daily verify; erase + re-fetch on the 1st of the month).
 *   - `fetchMasterSyncStatus()` — server-persisted `{ lastSyncAt,
 *     rewriteMonth, lastResult }` (cross-device timestamp near Recon Now).
 *   - `restoreFromSheets()` + `restoreToDatabase()` — DB-loss recovery: pull
 *     all 4 tabs through the server, upsert by Record ID with the anon key.
 *
 * Local dev note: `/api/*` only exists under `vercel dev`, not `vite dev`.
 */

const CHUNK = 500;

export interface TabSyncResult {
  tab: string;
  added: number;
  updated: number;
  deleted: number;
}

export interface MasterSyncResult {
  ok: boolean;
  tabs?: TabSyncResult[];
  fullRewrite?: boolean;
  ranAt?: number;
  error?: string;
}

export interface MasterSyncStatus {
  lastSyncAt: number | null;
  rewriteMonth: string | null;
  lastResult: TabSyncResult[] | null;
}

/** Same-origin API call with a generous timeout (a full herd push can run long). */
async function callApi<T>(url: string, init?: RequestInit, timeoutMs = 120000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Read the body first: error responses carry the actionable message
    // ({ ok: false, error }) — surfacing bare HTTP codes hides the cause.
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON error page (route missing, proxy failure, …)
    }
    if (!res.ok) throw new Error(data?.error || `Server returned HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timed out waiting for the server — the push may still complete; check the timestamp and retry');
    }
    throw err instanceof Error ? err : new Error('Network error');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMasterSyncStatus(): Promise<MasterSyncStatus> {
  const data = await callApi<{
    ok: boolean;
    lastSyncAt?: number | null;
    rewriteMonth?: string | null;
    lastResult?: TabSyncResult[] | null;
    error?: string;
  }>('/api/master-sync?view=status', {}, 15000);
  if (!data.ok) throw new Error(data.error ?? 'Could not read sync status');
  return {
    lastSyncAt: data.lastSyncAt ?? null,
    rewriteMonth: data.rewriteMonth ?? null,
    lastResult: data.lastResult ?? null,
  };
}

/**
 * Daily gate: exactly one push per calendar day. Pure function of the
 * server-persisted timestamp — works across devices.
 */
export function needsDailyPush(lastSyncAt: number | null, now = new Date()): boolean {
  if (!lastSyncAt) return true;
  const last = new Date(lastSyncAt);
  return (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth() !== now.getMonth() ||
    last.getDate() !== now.getDate()
  );
}

export async function triggerMasterSync(): Promise<MasterSyncResult> {
  try {
    const data = await callApi<{
      ok: boolean;
      summary?: TabSyncResult[];
      fullRewrite?: boolean;
      ranAt?: number;
      error?: string;
    }>('/api/master-sync', { method: 'POST' });
    if (!data.ok) return { ok: false, error: data.error ?? 'Sync failed' };
    return { ok: true, tabs: data.summary ?? [], fullRewrite: !!data.fullRewrite, ranAt: data.ranAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Sync failed' };
  }
}

// ─── Restore (Sheets -> app, for DB loss) ────────────────────────────────────

export interface RestoreData {
  goats: ReconRow[];
  weights: ReconRow[];
  dewormings: ReconRow[];
  vaccinations: ReconRow[];
}

export interface RestoreFetchResult {
  ok: boolean;
  data?: RestoreData;
  error?: string;
}

/** Pull all 4 tabs through the server (it holds the Apps Script secret). */
export async function restoreFromSheets(): Promise<RestoreFetchResult> {
  try {
    const data = await callApi<{
      ok: boolean;
      tabs?: Record<string, ReconRow[]>;
      error?: string;
    }>('/api/master-sync?view=tabs', {}, 60000);
    if (!data.ok || !data.tabs) {
      return { ok: false, error: data.error ?? 'Restore failed' };
    }
    return {
      ok: true,
      data: {
        goats: data.tabs['Goats Data'] ?? [],
        weights: data.tabs['Monthly Weights'] ?? [],
        dewormings: data.tabs['Deworming'] ?? [],
        vaccinations: data.tabs['Vaccination'] ?? [],
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Restore failed' };
  }
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string => String(v ?? '').trim();

const sheetDate = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export interface RestoreWriteResult {
  ok: boolean;
  added: { goats: number; weights: number; dewormings: number; vaccinations: number; sales: number };
  skipped: number;
  error?: string;
}

/**
 * Upserts restore data into Supabase, preserving Record IDs so cross-links
 * (weights/deworm/vacc -> goat) stay intact. Incremental: ids already in the
 * DB are skipped, so re-running changes nothing.
 *
 * Note: the sheet stores sales merged into the goat row (weight/rate/amount),
 * not full sale records — restored sales use a deterministic `sale_<goatId>`
 * id with buyer 'Restored' and today's date for the unknown fields.
 */
export async function restoreToDatabase(
  herdId: string,
  data: RestoreData,
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreWriteResult> {
  try {
    const existing = await Promise.all([
      supabase.from('goats').select('id'),
      supabase.from('weights').select('id'),
      supabase.from('deworming').select('id'),
      supabase.from('vaccinations').select('id'),
      supabase.from('sales').select('id'),
    ]);
    for (const r of existing) {
      if (r.error) throw r.error;
    }
    const seen = {
      goats: new Set((existing[0].data ?? []).map((r: { id: string }) => String(r.id))),
      weights: new Set((existing[1].data ?? []).map((r: { id: string }) => String(r.id))),
      deworming: new Set((existing[2].data ?? []).map((r: { id: string }) => String(r.id))),
      vaccinations: new Set((existing[3].data ?? []).map((r: { id: string }) => String(r.id))),
      sales: new Set((existing[4].data ?? []).map((r: { id: string }) => String(r.id))),
    };

    const now = new Date();
    const total =
      data.goats.length + data.weights.length + data.dewormings.length + data.vaccinations.length;
    let done = 0;
    const tick = (n = 1) => {
      done += n;
      onProgress?.(done, total);
    };
    let skipped = 0;

    // Goats first (children resolve goatId through these).
    const goatByEar = new Map<string, string>();
    const freshGoats: Record<string, unknown>[] = [];
    for (const r of data.goats) {
      const id = str(r.id);
      tick();
      if (!id) {
        skipped++;
        continue;
      }
      const ear = str(r.earTagNumber);
      if (ear) goatByEar.set(ear.toLowerCase(), id);
      if (seen.goats.has(id)) {
        skipped++;
        continue;
      }
      seen.goats.add(id);
      const gender = str(r.gender).toLowerCase() === 'female' ? 'female' : 'male';
      const statusRaw = str(r.status).toLowerCase();
      const status =
        statusRaw === 'sold' || statusRaw === 'deceased' ? statusRaw : 'active';
      freshGoats.push({
        id,
        earTagNumber: ear || id,
        farmerId: herdId,
        variant: str(r.variant) || 'LOCAL',
        gender,
        purchaseDate: sheetDate(r.purchaseDate) ?? now,
        purchaseWeight: num(r.purchaseWeight),
        purchasePrice: num(r.purchasePrice),
        sellerName: str(r.sellerName) || 'N/A',
        notes: str(r.notes) || null,
        status,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Ear tags of goats already in DB (for child rows pointing at them).
    if (goatByEar.size === 0 || data.weights.length + data.dewormings.length > 0) {
      const { data: dbGoats, error } = await supabase.from('goats').select('id,ear_tag_number');
      if (error) throw error;
      for (const g of dbGoats ?? []) {
        const ear = str((g as { ear_tag_number: string }).ear_tag_number);
        if (ear) goatByEar.set(ear.toLowerCase(), String((g as { id: string }).id));
      }
    }

    const goatIdFor = (earTagNumber: unknown): string | null => {
      const ear = str(earTagNumber).toLowerCase();
      return (ear && goatByEar.get(ear)) || null;
    };

    const freshWeights: Record<string, unknown>[] = [];
    for (const r of data.weights) {
      const id = str(r.id);
      tick();
      const goatId = goatIdFor(r.earTagNumber);
      if (!id || !goatId || seen.weights.has(id)) {
        skipped++;
        continue;
      }
      seen.weights.add(id);
      const weight = num(r.weight);
      freshWeights.push({
        id,
        goatId,
        weightNumber: Math.trunc(num(r.weightNumber)),
        weight,
        recordedDate: sheetDate(r.recordedDate),
        dueDate: sheetDate(r.dueDate) ?? now,
        weightGain: str(r.weightGain) === '' ? null : num(r.weightGain),
        remarks: str(r.remarks) || null,
        isRecorded: weight > 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const freshDeworm: Record<string, unknown>[] = [];
    for (const r of data.dewormings) {
      const id = str(r.id);
      tick();
      const goatId = goatIdFor(r.earTagNumber);
      if (!id || !goatId || seen.deworming.has(id)) {
        skipped++;
        continue;
      }
      seen.deworming.add(id);
      freshDeworm.push({
        id,
        goatId,
        dewormingDate: sheetDate(r.dewormingDate) ?? now,
        roundNumber: str(r.roundNumber) === '' ? null : Math.trunc(num(r.roundNumber)),
        medicineUsed: str(r.medicineUsed) || null,
        administeredBy: str(r.administeredBy) || null,
        batchNumber: str(r.batchNumber) || null,
        remarks: str(r.remarks) || null,
        status: 'dewormed',
        createdAt: now,
        updatedAt: now,
      });
    }

    const freshVacc: Record<string, unknown>[] = [];
    for (const r of data.vaccinations) {
      const id = str(r.id);
      tick();
      const goatId = goatIdFor(r.earTagNumber);
      if (!id || !goatId || seen.vaccinations.has(id)) {
        skipped++;
        continue;
      }
      seen.vaccinations.add(id);
      freshVacc.push({
        id,
        goatId,
        vaccinationDate: sheetDate(r.vaccinationDate) ?? now,
        roundNumber: str(r.roundNumber) === '' ? null : Math.trunc(num(r.roundNumber)),
        vaccineBrand: str(r.vaccineBrand) || null,
        administeredBy: str(r.administeredBy) || null,
        batchNumber: str(r.batchNumber) || null,
        remarks: str(r.remarks) || null,
        status: 'vaccinated',
        createdAt: now,
        updatedAt: now,
      });
    }

    // Sales live merged inside the goat rows — rebuild deterministic records.
    const freshSales: Record<string, unknown>[] = [];
    for (const r of data.goats) {
      const goatId = str(r.id);
      const amount = num(r.saleAmount);
      const weight = num(r.saleWeight);
      if (!goatId || (amount <= 0 && weight <= 0)) continue;
      const saleId = `sale_${goatId}`;
      if (seen.sales.has(saleId)) {
        skipped++;
        continue;
      }
      seen.sales.add(saleId);
      const rate = num(r.saleRatePerKg);
      freshSales.push({
        id: saleId,
        goatId,
        saleDate: now,
        saleWeight: weight,
        saleRatePerKg: rate,
        buyerName: 'Restored',
        saleAmount: amount || weight * rate,
        netProfit: num(r.netProfit),
        profitPercentage: 0,
        remarks: 'Restored from Master Sheet',
        createdAt: now,
        updatedAt: now,
      });
    }

    const insertChunked = async (table: string, rows: Record<string, unknown>[]) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from(table)
          .insert(rows.slice(i, i + CHUNK).map((r) => camelToSnake(r)));
        if (error) throw error;
      }
    };

    await insertChunked('goats', freshGoats);
    await insertChunked('weights', freshWeights);
    await insertChunked('deworming', freshDeworm);
    await insertChunked('vaccinations', freshVacc);
    await insertChunked('sales', freshSales);

    return {
      ok: true,
      added: {
        goats: freshGoats.length,
        weights: freshWeights.length,
        dewormings: freshDeworm.length,
        vaccinations: freshVacc.length,
        sales: freshSales.length,
      },
      skipped,
    };
  } catch (err) {
    return {
      ok: false,
      added: { goats: 0, weights: 0, dewormings: 0, vaccinations: 0, sales: 0 },
      skipped: 0,
      error: err instanceof Error ? err.message : 'Restore failed',
    };
  }
}
