import { supabase } from '@/lib/supabase';
import * as indexedDB from '@/lib/indexeddb';
import type { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo, OfflineAction, SyncHistoryItem, HerdMembership } from '@/types';
import { generateId } from '@/utils/helpers';

// ─── Shared herds ────────────────────────────────────────────────────────────
// A herd is anchored by the original owner's user id (goats.farmer_id).
// A login sees goats in every herd they own or are assigned to via
// herd_members. Memberships are cached in IndexedDB so offline mode can
// resolve herd scope without the server.

export interface HerdScope {
  /** Every visible herd anchor: own id + member herds (+ all herds for admins). */
  herdIds: string[];
  /** Herds the login may write to: own id + herds with their membership row. */
  writableHerdIds: string[];
}

export async function getHerdScope(userId: string): Promise<HerdScope> {
  const visible = new Set<string>([userId]);
  const writable = new Set<string>([userId]);

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      // No .eq filter: RLS scopes this to the caller's own rows for farmers
      // and to every row for admins — so admins automatically see all herds.
      const { data, error } = await supabase
        .from('herd_members')
        .select('herd_id,user_id');
      if (!error && data) {
        const freshMine = new Set<string>();
        for (const r of data as { herd_id: string; user_id: string }[]) {
          const hid = String(r.herd_id);
          visible.add(hid);
          if (String(r.user_id) === userId) {
            freshMine.add(hid);
            writable.add(hid);
          }
        }
        // Refresh the offline cache with OWN rows only: caching other users'
        // rows would let them overwrite mine under the shared herd-id key.
        try {
          for (const hid of freshMine) {
            await indexedDB.updateItem('memberships', {
              id: hid,
              userId,
              cachedAt: new Date(),
            } as HerdMembership);
          }
          const cached = await indexedDB.getAllItems<HerdMembership>('memberships');
          for (const m of cached) {
            if (m.userId === userId && !freshMine.has(m.id)) {
              await indexedDB.deleteItem('memberships', m.id).catch(() => {});
            }
          }
        } catch {
          // cache failures must never break online fetch
        }
      }
    } catch {
      // pre-migration (no table) or network error → fall through to cache
    }
  }

  try {
    const cached = await indexedDB.getAllItems<HerdMembership>('memberships');
    for (const m of cached) {
      if (m.userId === userId) {
        visible.add(m.id);
        writable.add(m.id);
      }
    }
  } catch {
    // no cache yet
  }

  return { herdIds: [...visible], writableHerdIds: [...writable] };
}

export async function getMyHerdIds(userId: string): Promise<string[]> {
  return (await getHerdScope(userId)).herdIds;
}

// Helper: Convert camelCase properties to snake_case for PostgreSQL insertion/update
export function camelToSnake(obj: any): any {
  if (obj instanceof Date) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(camelToSnake);
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc: any, key) => {
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      acc[snakeKey] = camelToSnake(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

// Helper: Convert snake_case properties back to camelCase for TypeScript consumption
export function snakeToCamel(obj: any): any {
  if (obj instanceof Date) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc: any, key) => {
      const camelKey = key.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace('-', '').replace('_', '')
      );
      acc[camelKey] = snakeToCamel(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

// Helper: Parse string fields back into Javascript Date objects
export function parseDates<T>(item: any, fields: string[]): T {
  if (!item) return item;
  const result = { ...item };
  for (const f of fields) {
    if (result[f]) {
      result[f] = new Date(result[f]);
    }
  }
  return result as T;
}

// Helper: Map goat record returned from Supabase (including joined sales records)
export function mapGoatData(item: any): Goat {
  const camelItem = snakeToCamel(item);
  const goat = parseDates<Goat>(camelItem, ['purchaseDate', 'createdAt', 'updatedAt']);

  if (item.sales && item.sales.length > 0) {
    const sale = snakeToCamel(item.sales[0]);
    goat.saleInfo = parseDates<SaleInfo>(sale, ['saleDate', 'createdAt', 'updatedAt']);
  }

  return goat;
}

// ─── Goat Services ───────────────────────────────────────────────────────────

export async function createGoat(
  farmerId: string,
  goatData: Omit<Goat, 'id' | 'createdAt' | 'updatedAt' | 'farmerId' | 'status'>
): Promise<string> {
  const id = generateId();
  const now = new Date();
  const goat: Goat = {
    ...goatData,
    id,
    farmerId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const w0: WeightRecord = {
    id: generateId(),
    goatId: id,
    weightNumber: 0,
    weight: goatData.purchaseWeight,
    dueDate: goatData.purchaseDate,
    recordedDate: goatData.purchaseDate,
    isRecorded: true,
    remarks: 'Purchase weight',
    createdAt: now,
    updatedAt: now,
  };

  const placeholders: WeightRecord[] = [];
  const scheduleIntervals = [30, 60, 90, 120];
  for (let i = 1; i <= 4; i++) {
    const dueDate = new Date(goatData.purchaseDate);
    dueDate.setDate(dueDate.getDate() + scheduleIntervals[i - 1]);
    placeholders.push({
      id: generateId(),
      goatId: id,
      weightNumber: i as 1 | 2 | 3 | 4,
      weight: 0,
      dueDate,
      isRecorded: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    if (!navigator.onLine) throw new Error('Offline');
    const { error: goatErr } = await supabase.from('goats').insert(camelToSnake(goat));
    if (goatErr) throw goatErr;

    const { error: wErr } = await supabase.from('weights').insert(camelToSnake([w0, ...placeholders]));
    if (wErr) throw wErr;

    try {
      await indexedDB.addItem('goats', goat);
      await indexedDB.addItem('weights', w0);
      for (const w of placeholders) {
        await indexedDB.addItem('weights', w);
      }
    } catch (e) {
      console.error('Failed to sync locally', e);
    }
  } catch (err: any) {
    const errMsg = err?.message || err?.error || err?.toString() || '';
    const isNetworkError = !navigator.onLine || errMsg === 'Offline' || errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('network');
    
    if (isNetworkError) {
      console.log('Offline: queuing goat creation locally');
      await indexedDB.addItem('goats', goat);
      await indexedDB.addItem('weights', w0);
      for (const w of placeholders) {
        await indexedDB.addItem('weights', w);
      }
      
      const offlineAction: OfflineAction = {
        id: generateId(),
        type: 'create',
        collection: 'goats',
        data: { goat, weights: [w0, ...placeholders] },
        timestamp: new Date(),
        synced: false,
      };
      // Type casting because offlineQueue might expect a slightly different type in some versions, but we know it works
      await indexedDB.addItem('offlineQueue', offlineAction as any);
    } else {
      throw err;
    }
  }

  return id;
}

export async function updateGoat(goatId: string, data: Partial<Goat>): Promise<void> {
  const updatedData = {
    ...data,
    updatedAt: new Date(),
  };
  
  // Omit nested objects like saleInfo to prevent SQL insertion errors
  const { saleInfo, ...dbData } = updatedData as any;

  try {
    if (!navigator.onLine) throw new Error('Offline');
    const { error } = await supabase
      .from('goats')
      .update(camelToSnake(dbData))
      .eq('id', goatId);
    if (error) throw error;

    try {
      const existing = await indexedDB.getItem<Goat>('goats', goatId);
      if (existing) {
        await indexedDB.updateItem('goats', { ...existing, ...updatedData });
      }
    } catch (e) {
      console.error('Failed to sync locally', e);
    }
  } catch (err: any) {
    const errMsg = err?.message || err?.error || err?.toString() || '';
    const isNetworkError = !navigator.onLine || errMsg === 'Offline' || errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('network');
    
    if (isNetworkError) {
      console.log('Offline: queuing goat update locally');
      
      const existing = await indexedDB.getItem<Goat>('goats', goatId);
      if (existing) {
        const localUpdated = { ...existing, ...updatedData };
        await indexedDB.updateItem('goats', localUpdated);
      }

      const offlineAction: OfflineAction = {
        id: generateId(),
        type: 'update',
        collection: 'goats',
        data: { id: goatId, updates: dbData },
        timestamp: new Date(),
        synced: false,
      };
      await indexedDB.addItem('offlineQueue', offlineAction as any);
    } else {
      throw err;
    }
  }
}

export async function getGoat(goatId: string): Promise<Goat | null> {
  const { data, error } = await supabase
    .from('goats')
    .select('*, sales(*)')
    .eq('id', goatId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapGoatData(data);
}

export async function getGoatByEarTag(farmerId: string, earTagNumber: string): Promise<Goat | null> {
  const checkLocal = async () => {
    try {
      const localGoats = await indexedDB.getAllItems<Goat>('goats');
      const activeGoat = localGoats.find(g => g.farmerId === farmerId && g.earTagNumber === earTagNumber && g.status === 'active');
      return activeGoat || null;
    } catch {
      return null;
    }
  };

  if (!navigator.onLine) {
    return checkLocal();
  }

  try {
    // Query all active goats with this ear tag to avoid duplicates for active herd
    const { data, error } = await supabase
      .from('goats')
      .select('*, sales(*)')
      .eq('ear_tag_number', earTagNumber)
      .eq('farmer_id', farmerId)
      .eq('status', 'active');
      
    if (error) throw error;
    if (!data || data.length === 0) {
      // It might be in the local queue only but not synced yet
      return checkLocal();
    }
    
    // Find the active one, or just return the first one if none are active
    const activeGoat = data[0];
    return mapGoatData(activeGoat);
  } catch (err: any) {
    const errMsg = err?.message || err?.error || err?.toString() || '';
    const isNetworkError = !navigator.onLine || errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('network');
    
    // If it fails due to network issues, fallback to offline DB
    if (isNetworkError) {
      return checkLocal();
    }
    throw err;
  }
}

export async function getFarmerGoats(farmerId: string, status?: 'active' | 'sold' | 'deceased'): Promise<Goat[]> {
  // Herd-aware: farmerId here is the login; the visible set is every herd the
  // login owns or is assigned to (resolved via cache when offline).
  const herdIds = await getMyHerdIds(farmerId);
  let query = supabase
    .from('goats')
    .select('*, sales(*)')
    .in('farmer_id', herdIds);
  if (status) {
    query = query.eq('status', status);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  
  const goats = (data || []).map(mapGoatData);
  
  // Sync down to local DB so offline mode has the latest data.
  // Then adopt-then-prune: demo-era local rows ('RKT'/'VIKI') that never
  // reached Supabase are pushed into the login's own herd (ear-tag deduped
  // against the server so nothing duplicates); anything still outside the
  // herd set afterwards is pruned so offline fallbacks can't leak herds the
  // login no longer belongs to.
  if (navigator.onLine) {
    Promise.all(goats.map(g => indexedDB.updateItem('goats', g))).catch(e => console.error('Failed to sync goats to local DB:', e));
    try {
      await adoptLegacyLocalRows(farmerId, goats);
    } catch (e) {
      console.error('Legacy herd adoption failed (will retry next sync):', e);
    }
    const allowed = new Set(herdIds);
    indexedDB.getAllItems<Goat>('goats').then((local) => {
      for (const g of local) {
        if (!allowed.has(g.farmerId)) {
          indexedDB.deleteItem('goats', g.id).catch(() => {});
        }
      }
    }).catch(() => {});
  }
  
  return goats;
}

// One-time demo-era recovery. Rows created under the old text ids never
// reached Supabase (uuid column rejects them) and live only in the device's
// IndexedDB. On login, push the login's OWN legacy rows into their herd —
// matched by the known email→tag mapping so one farmer can never adopt the
// other's orphans. Safe to remove once both herds are verified in Supabase.
const LEGACY_TAG_BY_EMAIL: Record<string, string> = {
  'rkte4e@gmail.com': 'RKT',
  'vikirthan06@gmail.com': 'VIKI',
};

async function adoptLegacyLocalRows(userId: string, serverGoats: Goat[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const tag = user?.email ? LEGACY_TAG_BY_EMAIL[user.email.toLowerCase()] : undefined;
  if (!tag) return;

  const local = await indexedDB.getAllItems<Goat>('goats');
  const orphans = local.filter((g) => g.farmerId === tag);
  if (orphans.length === 0) return;

  console.log(`Adopting ${orphans.length} legacy '${tag}' rows into herd ${userId}`);
  const takenTags = new Set(serverGoats.map((g) => g.earTagNumber.toLowerCase()));
  const [localWeights, localDeworm, localVacc] = await Promise.all([
    indexedDB.getAllItems<WeightRecord>('weights'),
    indexedDB.getAllItems<DewormingRecord>('deworming'),
    indexedDB.getAllItems<PPRVaccinationRecord>('vaccination'),
  ]);

  for (const o of orphans) {
    // Ear tag already on the server → stale duplicate, drop the local copy.
    if (takenTags.has(o.earTagNumber.toLowerCase())) {
      await indexedDB.deleteItem('goats', o.id).catch(() => {});
      continue;
    }
    const goat: Goat = { ...o, farmerId: userId, updatedAt: new Date() };
    const { error: gErr } = await supabase.from('goats').insert(camelToSnake(goat));
    if (gErr) throw gErr;
    const weights = localWeights.filter((w) => w.goatId === o.id);
    if (weights.length) {
      const { error } = await supabase.from('weights').insert(camelToSnake(weights));
      if (error) throw error;
    }
    const deworm = localDeworm.filter((d) => d.goatId === o.id);
    for (const d of deworm) {
      const { error } = await supabase.from('deworming').insert(camelToSnake(d));
      if (error) throw error;
    }
    const vacc = localVacc.filter((v) => v.goatId === o.id);
    for (const v of vacc) {
      const { error } = await supabase.from('vaccinations').insert(camelToSnake(v));
      if (error) throw error;
    }
    if (goat.status === 'sold' && goat.saleInfo) {
      const { error } = await supabase.from('sales').insert(camelToSnake(goat.saleInfo));
      if (error) throw error;
    }
    await indexedDB.updateItem('goats', goat);
    takenTags.add(o.earTagNumber.toLowerCase());
    console.log(`Adopted legacy goat ${o.earTagNumber}`);
  }
}

export async function deleteGoat(goatId: string): Promise<void> {
  // Delete related records to prevent foreign key constraint violations
  await supabase.from('weights').delete().eq('goat_id', goatId);
  await supabase.from('vaccinations').delete().eq('goat_id', goatId);
  await supabase.from('deworming').delete().eq('goat_id', goatId);
  await supabase.from('sales').delete().eq('goat_id', goatId);

  const { error } = await supabase
    .from('goats')
    .delete()
    .eq('id', goatId);
  if (error) throw error;

  // Immediately remove from local DB to prevent UI lag
  try {
    await indexedDB.deleteItem('goats', goatId);
  } catch (e) {
    console.error('Failed to delete goat locally', e);
  }
}

// ─── Weight Services ─────────────────────────────────────────────────────────

export async function recordWeight(
  goatId: string,
  weightData: Omit<WeightRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date();

  const { data: allWeights, error: fetchErr } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .eq('is_recorded', true)
    .gt('weight', 0);
  if (fetchErr) throw fetchErr;

  const goatWeights = (allWeights || [])
    .map((w) => parseDates<WeightRecord>(snakeToCamel(w), ['dueDate', 'recordedDate', 'createdAt', 'updatedAt']))
    .sort((a, b) => a.weightNumber - b.weightNumber);

  const prevWeight = goatWeights
    .filter((w) => w.weightNumber < weightData.weightNumber)
    .pop();

  const weightGain = prevWeight ? parseFloat((weightData.weight - prevWeight.weight).toFixed(2)) : undefined;

  const { data: existingRecords, error: checkErr } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .eq('weight_number', weightData.weightNumber);
  if (checkErr) throw checkErr;

  const existing = existingRecords && existingRecords.length > 0 ? snakeToCamel(existingRecords[0]) : null;

  if (existing) {
    const updated = {
      ...existing,
      weight: weightData.weight,
      recordedDate: weightData.recordedDate || now,
      remarks: weightData.remarks,
      isRecorded: true,
      weightGain,
      updatedAt: now,
    };
    const { error: updateErr } = await supabase
      .from('weights')
      .update(camelToSnake(updated))
      .eq('id', existing.id);
    if (updateErr) throw updateErr;
    
    try { await indexedDB.updateItem('weights', updated); } catch (e) {}
    
    return existing.id;
  } else {
    const id = generateId();
    const record: WeightRecord = {
      ...weightData,
      id,
      goatId,
      isRecorded: true,
      weightGain,
      createdAt: now,
      updatedAt: now,
    };
    const { error: insertErr } = await supabase
      .from('weights')
      .insert(camelToSnake(record));
    if (insertErr) throw insertErr;
    
    try { await indexedDB.addItem('weights', record); } catch (e) {}
    
    return id;
  }
}

export async function getGoatWeights(goatId: string): Promise<WeightRecord[]> {
  const { data, error } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .order('weight_number', { ascending: true });
  if (error) throw error;
  return (data || []).map((item: any) =>
    parseDates<WeightRecord>(snakeToCamel(item), ['dueDate', 'recordedDate', 'createdAt', 'updatedAt'])
  );
}

export async function getWeightRecord(goatId: string, weightNumber: number): Promise<WeightRecord | null> {
  const { data, error } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .eq('weight_number', weightNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return parseDates<WeightRecord>(snakeToCamel(data), ['dueDate', 'recordedDate', 'createdAt', 'updatedAt']);
}

// ─── Deworming Services ──────────────────────────────────────────────────────

export async function recordDeworming(
  goatId: string,
  dewormingData: Omit<DewormingRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date();
  const id = generateId();
  const record: DewormingRecord = {
    ...dewormingData,
    id,
    goatId,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase
    .from('deworming')
    .insert(camelToSnake(record));
  if (error) throw error;
  
  try { await indexedDB.addItem('deworming', record); } catch (e) {}
  
  return id;
}

export async function getAllDewormingForGoat(goatId: string): Promise<DewormingRecord[]> {
  const { data, error } = await supabase
    .from('deworming')
    .select('*')
    .eq('goat_id', goatId)
    .order('deworming_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((item: any) =>
    parseDates<DewormingRecord>(snakeToCamel(item), ['dewormingDate', 'createdAt', 'updatedAt'])
  );
}

export async function getGoatDeworming(goatId: string): Promise<DewormingRecord | null> {
  const all = await getAllDewormingForGoat(goatId);
  return all.length > 0 ? all[all.length - 1] : null;
}

// ─── PPR Vaccination Services ────────────────────────────────────────────────

export async function recordVaccination(
  goatId: string,
  vaccinationData: Omit<PPRVaccinationRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date();
  const id = generateId();
  const record: PPRVaccinationRecord = {
    ...vaccinationData,
    id,
    goatId,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase
    .from('vaccinations')
    .insert(camelToSnake(record));
  if (error) throw error;
  
  try { await indexedDB.addItem('vaccination', record); } catch (e) {}
  
  return id;
}

export async function getAllVaccinationsForGoat(goatId: string): Promise<PPRVaccinationRecord[]> {
  const { data, error } = await supabase
    .from('vaccinations')
    .select('*')
    .eq('goat_id', goatId)
    .order('vaccination_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((item: any) =>
    parseDates<PPRVaccinationRecord>(snakeToCamel(item), ['vaccinationDate', 'createdAt', 'updatedAt'])
  );
}

export async function getGoatVaccination(goatId: string): Promise<PPRVaccinationRecord | null> {
  const all = await getAllVaccinationsForGoat(goatId);
  return all.length > 0 ? all[all.length - 1] : null;
}

// ─── Sale Services ───────────────────────────────────────────────────────────

export async function recordSale(
  goatId: string,
  saleData: Omit<SaleInfo, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();
  const sale: SaleInfo = {
    ...saleData,
    id,
    goatId,
    createdAt: now,
    updatedAt: now,
  };

  const { error: saleErr } = await supabase
    .from('sales')
    .insert(camelToSnake(sale));
  if (saleErr) throw saleErr;

  const { error: goatErr } = await supabase
    .from('goats')
    .update({ status: 'sold', updated_at: now })
    .eq('id', goatId);
  if (goatErr) throw goatErr;

  try { 
    const existing = await indexedDB.getItem<Goat>('goats', goatId);
    if (existing) {
      await indexedDB.updateItem('goats', { ...existing, status: 'sold', updatedAt: now, saleInfo: sale });
    }
  } catch (e) {}

  return id;
}

export async function getSaleInfo(goatId: string): Promise<SaleInfo | null> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('goat_id', goatId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return parseDates<SaleInfo>(snakeToCamel(data), ['saleDate', 'createdAt', 'updatedAt']);
}

// ─── Reports and Notifications ───────────────────────────────────────────────
// NOTE: no explicit farmer_id filter here — RLS scopes these to the caller's
// own goats (child tables check goats.farmer_id = auth.uid() via goat_id).
// Callers only ever pass goats already filtered by getFarmerGoats(userId).

export async function getAllDeworming(): Promise<DewormingRecord[]> {
  const { data, error } = await supabase
    .from('deworming')
    .select('*')
    .order('deworming_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((item: any) =>
    parseDates<DewormingRecord>(snakeToCamel(item), ['dewormingDate', 'createdAt', 'updatedAt'])
  );
}

export async function getAllVaccinations(): Promise<PPRVaccinationRecord[]> {
  const { data, error } = await supabase
    .from('vaccinations')
    .select('*')
    .order('vaccination_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((item: any) =>
    parseDates<PPRVaccinationRecord>(snakeToCamel(item), ['vaccinationDate', 'createdAt', 'updatedAt'])
  );
}

export async function getAllWeights(): Promise<WeightRecord[]> {
  const { data, error } = await supabase
    .from('weights')
    .select('*')
    .order('weight_number', { ascending: true });
  if (error) throw error;
  const weights = (data || []).map((item: any) =>
    parseDates<WeightRecord>(snakeToCamel(item), ['dueDate', 'recordedDate', 'createdAt', 'updatedAt'])
  );

  if (navigator.onLine) {
    Promise.all(weights.map(w => indexedDB.updateItem('weights', w))).catch(e => console.error('Failed to sync weights to local DB:', e));
  }

  return weights;
}
// ─── Offline Sync ─────────────────────────────────────────────────────────────

// A push that fails RLS/permission (e.g. herd membership revoked while the
// action sat queued) will never succeed on retry — drop it into history as
// failed instead of retrying forever.
function isPermissionError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || err?.error || err || '').toLowerCase();
  return (
    code === '42501' ||
    msg.includes('row-level security') ||
    msg.includes('permission denied') ||
    msg.includes('not permitted') ||
    msg.includes('unauthorized')
  );
}

async function dropFailedAction(action: OfflineAction, reason: string): Promise<void> {
  console.error(`Dropping offline action ${action.id}: ${reason}`);
  await indexedDB.deleteItem('offlineQueue', action.id).catch(() => {});
  const historyItem: SyncHistoryItem = {
    id: generateId(),
    actionId: action.id,
    description: `Failed (no access — dropped): ${action.collection} ${action.type}`,
    syncedAt: new Date(),
  };
  await indexedDB.addItem('syncHistory', historyItem as any).catch(() => {});
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-synced'));
  }
}

export async function syncOfflineActions() {
  if (!navigator.onLine) return;
  
  try {
    const actions = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
    if (actions.length === 0) return;

    console.log(`Syncing ${actions.length} offline actions...`);
    
    for (const action of actions) {
      // Drop stale pre-migration queue entries keyed to demo ids — they can
      // never pass RLS (farmer_id must be the auth UUID now).
      const queuedFarmer = action.data?.goat?.farmerId;
      if (queuedFarmer === 'RKT' || queuedFarmer === 'VIKI') {
        await indexedDB.deleteItem('offlineQueue', action.id).catch(() => {});
        continue;
      }
      if (action.type === 'create' && action.collection === 'goats') {
        const { goat, weights } = action.data;
        
        try {
          // Push goat
          const { error: goatErr } = await supabase.from('goats').insert(camelToSnake(goat));
          if (goatErr) throw goatErr;

          // Push weights
          const { error: wErr } = await supabase.from('weights').insert(camelToSnake(weights));
          if (wErr) throw wErr;
          
          // Remove from queue on success
          await indexedDB.deleteItem('offlineQueue', action.id);
          
          // Log to history
          const historyItem: SyncHistoryItem = {
            id: generateId(),
            actionId: action.id,
            description: `Goat ${goat.earTagNumber} - creation synced`,
            syncedAt: new Date(),
          };
          await indexedDB.addItem('syncHistory', historyItem as any);
          
          console.log(`Successfully synced goat ${goat.earTagNumber}`);
        } catch (err) {
          console.error(`Failed to sync offline create action ${action.id}:`, err);
          if (isPermissionError(err)) await dropFailedAction(action, String((err as any)?.message || err));
        }
      } else if (action.type === 'update' && action.collection === 'goats') {
        const { id, updates } = action.data;
        try {
          const { error: updateErr } = await supabase.from('goats').update(camelToSnake(updates)).eq('id', id);
          if (updateErr) throw updateErr;
          
          await indexedDB.deleteItem('offlineQueue', action.id);
          
          // Fetch goat to get ear tag for nice description, or fallback
          let goatDesc = id;
          try {
            const localGoat = await indexedDB.getItem<Goat>('goats', id);
            if (localGoat) goatDesc = localGoat.earTagNumber;
          } catch (e) {}

          const historyItem: SyncHistoryItem = {
            id: generateId(),
            actionId: action.id,
            description: `Goat ${goatDesc} - edits synced`,
            syncedAt: new Date(),
          };
          await indexedDB.addItem('syncHistory', historyItem as any);

          console.log(`Successfully synced updated goat ${id}`);
        } catch (err) {
          console.error(`Failed to sync offline update action ${action.id}:`, err);
          if (isPermissionError(err)) await dropFailedAction(action, String((err as any)?.message || err));
        }
      }
    }
  } catch (err) {
    console.error('Error during offline sync:', err);
  }
}

// Automatically sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncOfflineActions);
  // Also try on load
  setTimeout(syncOfflineActions, 2000);
}
