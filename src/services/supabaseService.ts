import { supabase } from '@/lib/supabase';
import * as indexedDB from '@/lib/indexeddb';
import type { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo, OfflineAction } from '@/types';
import { generateId } from '@/utils/helpers';

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
  } catch (err: any) {
    if (!navigator.onLine || err.message === 'Offline' || err.message?.includes('fetch') || err.message?.includes('Failed to fetch')) {
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

  const { error } = await supabase
    .from('goats')
    .update(camelToSnake(dbData))
    .eq('id', goatId);
  if (error) throw error;
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
  // If offline, bypass the unique ear tag check so it can be queued
  if (!navigator.onLine) {
    return null;
  }

  try {
    // Query all goats with this ear tag to avoid the "multiple rows" error from maybeSingle()
    const { data, error } = await supabase
      .from('goats')
      .select('*, sales(*)')
      .eq('ear_tag_number', earTagNumber)
      .eq('farmer_id', farmerId);
      
    if (error) throw error;
    if (!data || data.length === 0) return null;
    
    // Find the active one, or just return the first one if none are active
    const activeGoat = data.find(g => g.status === 'active') || data[0];
    return mapGoatData(activeGoat);
  } catch (err: any) {
    // If it fails due to network issues, allow the flow to proceed to offline queueing
    if (err.message === 'Failed to fetch' || err.message?.includes('fetch')) {
      return null;
    }
    throw err;
  }
}

export async function getFarmerGoats(_farmerId: string, status?: 'active' | 'sold' | 'deceased'): Promise<Goat[]> {
  let query = supabase
    .from('goats')
    .select('*, sales(*)');
  if (status) {
    query = query.eq('status', status);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapGoatData);
}

export async function deleteGoat(goatId: string): Promise<void> {
  const { error } = await supabase
    .from('goats')
    .delete()
    .eq('id', goatId);
  if (error) throw error;
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
  return (data || []).map((item: any) =>
    parseDates<WeightRecord>(snakeToCamel(item), ['dueDate', 'recordedDate', 'createdAt', 'updatedAt'])
  );
}
// ─── Offline Sync ─────────────────────────────────────────────────────────────

export async function syncOfflineActions() {
  if (!navigator.onLine) return;
  
  try {
    const actions = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
    if (actions.length === 0) return;

    console.log(`Syncing ${actions.length} offline actions...`);
    
    for (const action of actions) {
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
          console.log(`Successfully synced goat ${goat.earTagNumber}`);
        } catch (err) {
          console.error(`Failed to sync offline action ${action.id}:`, err);
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
