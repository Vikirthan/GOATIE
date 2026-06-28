import { supabase } from '@/lib/supabase';
import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo } from '@/types';
import { generateId } from '@/utils/helpers';
import * as indexedDB from '@/lib/indexeddb';
import * as sheetsService from './sheetsStorageService';

// Determine if we should route to Sheets/IndexedDB instead of Supabase
const useSheetsOrLocal = (): boolean => {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  const isDemo = cachedDemoUser !== null;
  return isDemo || sheetsService.isSheetsConfigured();
};

// --- MAPPING HELPERS FOR SUPABASE (snake_case Postgres <-> camelCase TS) ---

function mapGoatFromDB(row: any): Goat {
  return {
    id: row.id,
    earTagNumber: row.ear_tag_number,
    farmerId: row.farmer_id,
    purchaseDate: new Date(row.purchase_date),
    purchaseWeight: Number(row.purchase_weight),
    purchasePrice: Number(row.purchase_price),
    variant: row.variant,
    gender: row.gender,
    sellerName: row.seller_name || 'N/A',
    sellerContact: row.seller_contact || undefined,
    notes: row.notes || undefined,
    photoURL: row.photo_url || undefined,
    qrCode: row.qr_code || undefined,
    barcode: row.barcode || undefined,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapGoatToDB(goat: Goat): any {
  return {
    id: goat.id,
    farmer_id: goat.farmerId,
    ear_tag_number: goat.earTagNumber,
    purchase_date: goat.purchaseDate.toISOString(),
    purchase_weight: goat.purchaseWeight,
    purchase_price: goat.purchasePrice,
    variant: goat.variant,
    gender: goat.gender,
    seller_name: goat.sellerName || 'N/A',
    seller_contact: goat.sellerContact || null,
    notes: goat.notes || null,
    photo_url: goat.photoURL || null,
    qr_code: goat.qrCode || null,
    barcode: goat.barcode || null,
    status: goat.status,
    created_at: goat.createdAt.toISOString(),
    updated_at: goat.updatedAt.toISOString(),
  };
}

function mapWeightFromDB(row: any): WeightRecord {
  return {
    id: row.id,
    goatId: row.goat_id,
    weightNumber: row.weight_number,
    weight: Number(row.weight),
    dueDate: new Date(row.due_date),
    recordedDate: row.recorded_date ? new Date(row.recorded_date) : undefined,
    remarks: row.remarks || undefined,
    isRecorded: row.is_recorded,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapWeightToDB(w: WeightRecord): any {
  return {
    id: w.id,
    goat_id: w.goatId,
    weight_number: w.weightNumber,
    weight: w.weight,
    due_date: w.dueDate.toISOString(),
    recorded_date: w.recordedDate ? w.recordedDate.toISOString() : null,
    remarks: w.remarks || null,
    is_recorded: w.isRecorded,
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
  };
}

function mapDewormingFromDB(row: any): DewormingRecord {
  return {
    id: row.id,
    goatId: row.goat_id,
    dewormingDate: new Date(row.deworming_date),
    medicineUsed: row.medicine_used,
    batchNumber: row.batch_number || undefined,
    administeredBy: row.administered_by,
    remarks: row.remarks || undefined,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapDewormingToDB(d: DewormingRecord): any {
  return {
    id: d.id,
    goat_id: d.goatId,
    deworming_date: d.dewormingDate.toISOString(),
    medicine_used: d.medicineUsed,
    batch_number: d.batchNumber || null,
    administered_by: d.administeredBy,
    remarks: d.remarks || null,
    status: d.status,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

function mapVaccinationFromDB(row: any): PPRVaccinationRecord {
  return {
    id: row.id,
    goatId: row.goat_id,
    vaccinationDate: new Date(row.vaccination_date),
    vaccineBrand: row.vaccine_brand,
    batchNumber: row.batch_number || undefined,
    administeredBy: row.administered_by,
    remarks: row.remarks || undefined,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapVaccinationToDB(v: PPRVaccinationRecord): any {
  return {
    id: v.id,
    goat_id: v.goatId,
    vaccination_date: v.vaccinationDate.toISOString(),
    vaccine_brand: v.vaccineBrand,
    batch_number: v.batchNumber || null,
    administered_by: v.administeredBy,
    remarks: v.remarks || null,
    status: v.status,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
  };
}

function mapSaleFromDB(row: any): SaleInfo {
  return {
    id: row.id,
    goatId: row.goat_id,
    saleDate: new Date(row.sale_date),
    saleWeight: Number(row.sale_weight),
    saleRatePerKg: Number(row.sale_rate_per_kg),
    buyerName: row.buyer_name,
    buyerContact: row.buyer_contact || undefined,
    saleAmount: Number(row.sale_amount),
    commission: row.commission ? Number(row.commission) : undefined,
    transportCharges: row.transport_charges ? Number(row.transport_charges) : undefined,
    otherCharges: row.other_charges ? Number(row.other_charges) : undefined,
    netProfit: Number(row.net_profit),
    profitPercentage: Number(row.profit_percentage),
    remarks: row.remarks || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapSaleToDB(s: SaleInfo): any {
  return {
    id: s.id,
    goat_id: s.goatId,
    sale_date: s.saleDate.toISOString(),
    sale_weight: s.saleWeight,
    sale_rate_per_kg: s.saleRatePerKg,
    buyer_name: s.buyerName,
    buyer_contact: s.buyerContact || null,
    sale_amount: s.saleAmount,
    commission: s.commission || null,
    transport_charges: s.transportCharges || null,
    other_charges: s.otherCharges || null,
    net_profit: s.netProfit,
    profit_percentage: s.profitPercentage,
    remarks: s.remarks || null,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

// --- DATABASE SERVICE ENDPOINTS ---

export async function getGoat(goatId: string): Promise<Goat | null> {
  if (useSheetsOrLocal()) {
    // Try local IndexedDB first for speed
    const localGoat = await indexedDB.getItem<Goat>('goats', goatId);
    
    // Fetch from Google Sheets in the background to update cache
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getGoatsSheet().then(async (goats) => {
        const fresh = goats.find((g) => g.id === goatId);
        if (fresh) {
          await indexedDB.updateItem('goats', fresh);
        }
      }).catch((err) => {
        console.error('Error background fetching goat from Google Sheets:', err);
      });
    }

    return localGoat || null;
  }

  const { data, error } = await supabase.from('goats').select('*').eq('id', goatId).maybeSingle();
  if (error || !data) return null;
  return mapGoatFromDB(data);
}

export async function getGoatByEarTag(farmerId: string, earTagNumber: string): Promise<Goat | null> {
  if (useSheetsOrLocal()) {
    const goats = await indexedDB.getAllItems<Goat>('goats');
    const localMatch = goats.find((g) => g.farmerId === farmerId && g.earTagNumber === earTagNumber) || null;

    // Fetch from Google Sheets in the background to update cache
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getGoatsSheet().then(async (freshGoats) => {
        for (const g of freshGoats) {
          await indexedDB.updateItem('goats', g);
        }
      }).catch((err) => {
        console.error('Error background fetching goats for ear tag check:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('goats')
    .select('*')
    .eq('farmer_id', farmerId)
    .eq('ear_tag_number', earTagNumber)
    .maybeSingle();

  if (error || !data) return null;
  return mapGoatFromDB(data);
}

export async function getFarmerGoats(farmerId: string, status?: 'active' | 'sold' | 'deceased'): Promise<Goat[]> {
  if (useSheetsOrLocal()) {
    // First read from IndexedDB
    const localGoats = await indexedDB.getAllItems<Goat>('goats');
    let filtered = localGoats.filter((g) => g.farmerId === farmerId);
    if (status) {
      filtered = filtered.filter((g) => g.status === status);
    }
    const sortedLocal = filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Trigger background update from Google Sheets
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getGoatsSheet().then(async (freshGoats) => {
        // Find existing local goats to not wipe other farmers if multi-tenant
        const otherFarmersGoats = localGoats.filter((g) => g.farmerId !== farmerId);
        const mergedGoats = [...otherFarmersGoats, ...freshGoats.filter((g) => g.farmerId === farmerId)];
        
        await indexedDB.clearStore('goats');
        for (const g of mergedGoats) {
          await indexedDB.updateItem('goats', g);
        }
      }).catch((err) => {
        console.error('Error background updating farmer goats from Google Sheets:', err);
      });
    }

    return sortedLocal;
  }

  let queryBuilder = supabase.from('goats').select('*').eq('farmer_id', farmerId);
  if (status) {
    queryBuilder = queryBuilder.eq('status', status);
  }

  const { data, error } = await queryBuilder.order('created_at', { ascending: false });
  if (error || !data) return [];

  const goats = data.map(mapGoatFromDB);

  // Fetch saleInfo for sold goats to populate nested structures
  const soldGoatIds = goats.filter((g) => g.status === 'sold').map((g) => g.id);
  if (soldGoatIds.length > 0) {
    const { data: salesData } = await supabase.from('sales').select('*').in('goat_id', soldGoatIds);
    if (salesData) {
      salesData.forEach((row) => {
        const goat = goats.find((g) => g.id === row.goat_id);
        if (goat) {
          goat.saleInfo = mapSaleFromDB(row);
        }
      });
    }
  }

  return goats;
}

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

  // Generate weightNumber 0 (Purchase Weight, recorded immediately)
  const purchaseDate = new Date(goat.purchaseDate);
  const w0: WeightRecord = {
    id: generateId(),
    goatId: id,
    weightNumber: 0,
    weight: goat.purchaseWeight,
    dueDate: purchaseDate,
    recordedDate: purchaseDate,
    isRecorded: true,
    createdAt: now,
    updatedAt: now,
  };

  // Helper to add months to a date
  const addMonths = (date: Date, months: number): Date => {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  };

  // Generate weightNumber 1, 2, 3, 4 placeholders (unrecorded, with monthly due dates)
  const placeholders: WeightRecord[] = [];
  for (let m = 1; m <= 4; m++) {
    placeholders.push({
      id: generateId(),
      goatId: id,
      weightNumber: m as any,
      weight: 0,
      dueDate: addMonths(purchaseDate, m),
      isRecorded: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (useSheetsOrLocal()) {
    // Write locally to IndexedDB immediately
    await indexedDB.addItem('goats', goat);
    await indexedDB.addItem('weights', w0);
    for (const w of placeholders) {
      await indexedDB.addItem('weights', w);
    }
    
    // Sync with Google Sheets in the background
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.writeGoatSheet(goat).catch((err) => {
        console.error('Error background syncing createGoat to Google Sheets:', err);
      });
      sheetsService.writeWeightSheet(w0).catch((err) => {
        console.error('Error background syncing weight 0 to Google Sheets:', err);
      });
      for (const w of placeholders) {
        sheetsService.writeWeightSheet(w).catch((err) => {
          console.error('Error background syncing placeholder weights to Google Sheets:', err);
        });
      }
    }
    return id;
  }

  // Supabase Database insertions
  const { error: goatErr } = await supabase.from('goats').insert(mapGoatToDB(goat));
  if (goatErr) throw goatErr;

  const { error: w0Err } = await supabase.from('weights').insert(mapWeightToDB(w0));
  if (w0Err) throw w0Err;

  const { error: placeholdersErr } = await supabase.from('weights').insert(placeholders.map(mapWeightToDB));
  if (placeholdersErr) throw placeholdersErr;

  return id;
}

export async function updateGoat(goatId: string, data: Partial<Goat>): Promise<void> {
  if (useSheetsOrLocal()) {
    const existing = await indexedDB.getItem<Goat>('goats', goatId);
    if (existing) {
      const updatedGoat = {
        ...existing,
        ...data,
        updatedAt: new Date(),
      };
      await indexedDB.updateItem('goats', updatedGoat);

      if (sheetsService.isSheetsConfigured()) {
        sheetsService.updateGoatSheet(updatedGoat).catch((err) => {
          console.error('Error background syncing updateGoat to Google Sheets:', err);
        });
      }
    }
    return;
  }

  const updateData: any = {};
  if (data.earTagNumber !== undefined) updateData.ear_tag_number = data.earTagNumber;
  if (data.purchaseDate !== undefined) updateData.purchase_date = data.purchaseDate.toISOString();
  if (data.purchaseWeight !== undefined) updateData.purchase_weight = data.purchaseWeight;
  if (data.purchasePrice !== undefined) updateData.purchase_price = data.purchasePrice;
  if (data.variant !== undefined) updateData.variant = data.variant;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.photoURL !== undefined) updateData.photo_url = data.photoURL;
  if (data.status !== undefined) updateData.status = data.status;
  updateData.updated_at = new Date().toISOString();

  const { error } = await supabase.from('goats').update(updateData).eq('id', goatId);
  if (error) throw error;
}

export async function deleteGoat(goatId: string): Promise<void> {
  if (useSheetsOrLocal()) {
    await indexedDB.deleteItem('goats', goatId);
    
    // Clear weights, deworming, vaccinations associated with it locally
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    const localDeworm = await indexedDB.getAllItems<DewormingRecord>('deworming');
    const localVacc = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');

    for (const w of localWeights.filter((w) => w.goatId === goatId)) {
      await indexedDB.deleteItem('weights', w.id);
    }
    for (const d of localDeworm.filter((d) => d.goatId === goatId)) {
      await indexedDB.deleteItem('deworming', d.id);
    }
    for (const v of localVacc.filter((v) => v.goatId === goatId)) {
      await indexedDB.deleteItem('vaccination', v.id);
    }

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.deleteGoatSheet(goatId).catch((err) => {
        console.error('Error background deleting goat from Google Sheets:', err);
      });
    }
    return;
  }

  const { error } = await supabase.from('goats').delete().eq('id', goatId);
  if (error) throw error;
}

// Weight Record Services
export async function recordWeight(
  goatId: string,
  weightData: Omit<WeightRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date();

  if (useSheetsOrLocal()) {
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    const existing = localWeights.find((w) => w.goatId === goatId && w.weightNumber === weightData.weightNumber);

    if (existing) {
      const updated = {
        ...existing,
        weight: weightData.weight,
        recordedDate: weightData.recordedDate || now,
        remarks: weightData.remarks,
        isRecorded: true,
        updatedAt: now,
      };
      await indexedDB.updateItem('weights', updated);
      if (sheetsService.isSheetsConfigured()) {
        sheetsService.updateWeightSheet(updated).catch((err) => {
          console.error('Error background updating weight to Google Sheets:', err);
        });
      }
      return existing.id;
    } else {
      const id = generateId();
      const record: WeightRecord = {
        ...weightData,
        id,
        goatId,
        isRecorded: true,
        createdAt: now,
        updatedAt: now,
      };
      await indexedDB.addItem('weights', record);
      if (sheetsService.isSheetsConfigured()) {
        sheetsService.writeWeightSheet(record).catch((err) => {
          console.error('Error background syncing weight to Google Sheets:', err);
        });
      }
      return id;
    }
  }

  // Supabase: Find if placeholder exists
  const { data: existing } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .eq('weight_number', weightData.weightNumber)
    .maybeSingle();

  if (existing) {
    const updated = {
      ...existing,
      weight: weightData.weight,
      recorded_date: weightData.recordedDate ? weightData.recordedDate.toISOString() : now.toISOString(),
      remarks: weightData.remarks || null,
      is_recorded: true,
      updated_at: now.toISOString(),
    };
    const { error } = await supabase.from('weights').update(updated).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  } else {
    const id = generateId();
    const record: WeightRecord = {
      ...weightData,
      id,
      goatId,
      isRecorded: true,
      createdAt: now,
      updatedAt: now,
    };
    const { error } = await supabase.from('weights').insert(mapWeightToDB(record));
    if (error) throw error;
    return id;
  }
}

export async function getGoatWeights(goatId: string): Promise<WeightRecord[]> {
  if (useSheetsOrLocal()) {
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    const localMatch = localWeights.filter((w) => w.goatId === goatId).sort((a, b) => a.weightNumber - b.weightNumber);

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getWeightsSheet().then(async (freshWeights) => {
        for (const w of freshWeights) {
          await indexedDB.updateItem('weights', w);
        }
      }).catch((err) => {
        console.error('Error background fetching weights from Google Sheets:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .order('weight_number', { ascending: true });

  if (error || !data) return [];
  return data.map(mapWeightFromDB);
}

export async function getWeightRecord(goatId: string, weightNumber: number): Promise<WeightRecord | null> {
  if (useSheetsOrLocal()) {
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    const localMatch = localWeights.find((w) => w.goatId === goatId && w.weightNumber === weightNumber) || null;

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getWeightsSheet().then(async (freshWeights) => {
        for (const w of freshWeights) {
          await indexedDB.updateItem('weights', w);
        }
      }).catch((err) => {
        console.error('Error background fetching weight record:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('weights')
    .select('*')
    .eq('goat_id', goatId)
    .eq('weight_number', weightNumber)
    .maybeSingle();

  if (error || !data) return null;
  return mapWeightFromDB(data);
}

// Deworming Services
export async function recordDeworming(
  goatId: string,
  data: Omit<DewormingRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();
  const record: DewormingRecord = {
    ...data,
    id,
    goatId,
    status: 'dewormed',
    createdAt: now,
    updatedAt: now,
  };

  if (useSheetsOrLocal()) {
    await indexedDB.addItem('deworming', record);
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.writeDewormingSheet(record).catch((err) => {
        console.error('Error background syncing deworming to Google Sheets:', err);
      });
    }
    return id;
  }

  const { error } = await supabase.from('deworming').insert(mapDewormingToDB(record));
  if (error) throw error;
  return id;
}

export async function getGoatDeworming(goatId: string): Promise<DewormingRecord | null> {
  if (useSheetsOrLocal()) {
    const localRecords = await indexedDB.getAllItems<DewormingRecord>('deworming');
    const localMatch = localRecords.find((r) => r.goatId === goatId) || null;

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getDewormingSheet().then(async (freshRecords) => {
        for (const r of freshRecords) {
          await indexedDB.updateItem('deworming', r);
        }
      }).catch((err) => {
        console.error('Error background fetching deworming records:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('deworming')
    .select('*')
    .eq('goat_id', goatId)
    .order('deworming_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapDewormingFromDB(data);
}

// PPR Vaccination Services
export async function recordVaccination(
  goatId: string,
  data: Omit<PPRVaccinationRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();
  const record: PPRVaccinationRecord = {
    ...data,
    id,
    goatId,
    status: 'vaccinated',
    createdAt: now,
    updatedAt: now,
  };

  if (useSheetsOrLocal()) {
    await indexedDB.addItem('vaccination', record);
    if (sheetsService.isSheetsConfigured()) {
      sheetsService.writeVaccinationSheet(record).catch((err) => {
        console.error('Error background syncing vaccination to Google Sheets:', err);
      });
    }
    return id;
  }

  const { error } = await supabase.from('vaccination').insert(mapVaccinationToDB(record));
  if (error) throw error;
  return id;
}

export async function getGoatVaccination(goatId: string): Promise<PPRVaccinationRecord | null> {
  if (useSheetsOrLocal()) {
    const localRecords = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
    const localMatch = localRecords.find((r) => r.goatId === goatId) || null;

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getVaccinationSheet().then(async (freshRecords) => {
        for (const r of freshRecords) {
          await indexedDB.updateItem('vaccination', r);
        }
      }).catch((err) => {
        console.error('Error background fetching vaccinations:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('vaccination')
    .select('*')
    .eq('goat_id', goatId)
    .order('vaccination_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapVaccinationFromDB(data);
}

// Sale Services
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

  if (useSheetsOrLocal()) {
    await updateGoat(goatId, { status: 'sold', saleInfo: sale });
    await indexedDB.addItem('sales', sale);

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.writeSaleSheet(sale).catch((err) => {
        console.error('Error background syncing sale to Google Sheets:', err);
      });
    }
    return id;
  }

  await updateGoat(goatId, { status: 'sold' });

  const { error } = await supabase.from('sales').insert(mapSaleToDB(sale));
  if (error) throw error;
  
  return id;
}

export async function getSaleInfo(goatId: string): Promise<SaleInfo | null> {
  if (useSheetsOrLocal()) {
    const localSales = await indexedDB.getAllItems<SaleInfo>('sales');
    const localMatch = localSales.find((s) => s.goatId === goatId) || null;

    if (sheetsService.isSheetsConfigured()) {
      sheetsService.getSalesSheet().then(async (freshSales) => {
        for (const s of freshSales) {
          await indexedDB.updateItem('sales', s);
        }
      }).catch((err) => {
        console.error('Error background fetching sales info:', err);
      });
    }

    return localMatch;
  }

  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('goat_id', goatId)
    .maybeSingle();

  if (error || !data) return null;
  return mapSaleFromDB(data);
}

// Search and filter
export async function searchGoats(farmerId: string, searchTerm: string): Promise<Goat[]> {
  const allGoats = await getFarmerGoats(farmerId);

  return allGoats.filter(
    (goat) =>
      goat.earTagNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      goat.variant.toLowerCase().includes(searchTerm.toLowerCase())
  );
}

export async function getGoatsDueForWeight(farmerId: string): Promise<{ goat: Goat; weight: WeightRecord }[]> {
  const goats = await getFarmerGoats(farmerId, 'active');
  const now = new Date();
  const results: { goat: Goat; weight: WeightRecord }[] = [];

  for (const goat of goats) {
    const weights = await getGoatWeights(goat.id);

    for (const weight of weights) {
      if (!weight.isRecorded && new Date(weight.dueDate) <= now) {
        results.push({ goat, weight });
      }
    }
  }

  return results;
}

export async function getPendingDeworming(farmerId: string): Promise<Goat[]> {
  const goats = await getFarmerGoats(farmerId, 'active');
  const pending: Goat[] = [];

  for (const goat of goats) {
    const deworm = await getGoatDeworming(goat.id);
    if (!deworm) {
      pending.push(goat);
    }
  }

  return pending;
}

export async function getPendingVaccination(farmerId: string): Promise<Goat[]> {
  const goats = await getFarmerGoats(farmerId, 'active');
  const pending: Goat[] = [];

  for (const goat of goats) {
    const vacc = await getGoatVaccination(goat.id);
    if (!vacc) {
      pending.push(goat);
    }
  }

  return pending;
}

export async function getAllDeworming(): Promise<DewormingRecord[]> {
  if (useSheetsOrLocal()) {
    if (sheetsService.isSheetsConfigured()) {
      try {
        const data = await sheetsService.getDewormingSheet();
        for (const r of data) {
          await indexedDB.updateItem('deworming', r);
        }
        return data;
      } catch (err) {
        console.error('Error fetching deworming sheet:', err);
      }
    }
    return await indexedDB.getAllItems<DewormingRecord>('deworming');
  }

  const { data, error } = await supabase.from('deworming').select('*');
  if (error || !data) return [];
  return data.map(mapDewormingFromDB);
}

export async function getAllVaccinations(): Promise<PPRVaccinationRecord[]> {
  if (useSheetsOrLocal()) {
    if (sheetsService.isSheetsConfigured()) {
      try {
        const data = await sheetsService.getVaccinationSheet();
        for (const r of data) {
          await indexedDB.updateItem('vaccination', r);
        }
        return data;
      } catch (err) {
        console.error('Error fetching vaccination sheet:', err);
      }
    }
    return await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
  }

  const { data, error } = await supabase.from('vaccination').select('*');
  if (error || !data) return [];
  return data.map(mapVaccinationFromDB);
}
