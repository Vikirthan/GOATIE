import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  Query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo } from '@/types';
import { generateId } from '@/utils/helpers';
import * as indexedDB from '@/lib/indexeddb';
import * as sheetsService from './sheetsStorageService';

// Determine if we should route to Sheets/IndexedDB instead of Firestore
const useSheetsOrLocal = (): boolean => {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  const isDemo = cachedDemoUser !== null;
  return isDemo || !db || sheetsService.isSheetsConfigured();
};

// Goat Services
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

  if (useSheetsOrLocal()) {
    // Write locally to IndexedDB
    await indexedDB.addItem('goats', goat);
    
    // Sync with Google Sheets if configured
    if (sheetsService.isSheetsConfigured()) {
      try {
        await sheetsService.writeGoatSheet(goat);
      } catch (err) {
        console.error('Error syncing createGoat to Google Sheets:', err);
      }
    }
    return id;
  }

  await setDoc(doc(db, 'goats', id), goat);
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
        try {
          await sheetsService.updateGoatSheet(updatedGoat);
        } catch (err) {
          console.error('Error syncing updateGoat to Google Sheets:', err);
        }
      }
    }
    return;
  }

  await updateDoc(doc(db, 'goats', goatId), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function getGoat(goatId: string): Promise<Goat | null> {
  if (useSheetsOrLocal()) {
    // Try Google Sheets first if configured
    if (sheetsService.isSheetsConfigured()) {
      try {
        const goats = await sheetsService.getGoatsSheet();
        const goat = goats.find((g) => g.id === goatId) || null;
        if (goat) {
          // Cache in IndexedDB
          await indexedDB.updateItem('goats', goat);
          return goat;
        }
      } catch (err) {
        console.error('Error fetching goat from Google Sheets:', err);
      }
    }
    
    // Fallback to IndexedDB
    return (await indexedDB.getItem<Goat>('goats', goatId)) || null;
  }

  const snapshot = await getDoc(doc(db, 'goats', goatId));
  return snapshot.exists() ? (snapshot.data() as Goat) : null;
}

export async function getGoatByEarTag(farmerId: string, earTagNumber: string): Promise<Goat | null> {
  if (useSheetsOrLocal()) {
    let goats: Goat[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        goats = await sheetsService.getGoatsSheet();
        // Update local cache
        for (const g of goats) {
          await indexedDB.updateItem('goats', g);
        }
      } catch (err) {
        console.error('Error fetching goats from Google Sheets:', err);
        goats = await indexedDB.getAllItems<Goat>('goats');
      }
    } else {
      goats = await indexedDB.getAllItems<Goat>('goats');
    }

    return goats.find((g) => g.farmerId === farmerId && g.earTagNumber === earTagNumber) || null;
  }

  const q = query(
    collection(db, 'goats'),
    where('farmerId', '==', farmerId),
    where('earTagNumber', '==', earTagNumber)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Goat);
}

export async function getFarmerGoats(farmerId: string, status?: 'active' | 'sold' | 'deceased'): Promise<Goat[]> {
  if (useSheetsOrLocal()) {
    let goats: Goat[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        goats = await sheetsService.getGoatsSheet();
        // Cache in IndexedDB
        await indexedDB.clearStore('goats');
        for (const g of goats) {
          await indexedDB.updateItem('goats', g);
        }
      } catch (err) {
        console.error('Error fetching farmer goats from Google Sheets:', err);
        goats = await indexedDB.getAllItems<Goat>('goats');
      }
    } else {
      goats = await indexedDB.getAllItems<Goat>('goats');
    }

    let filtered = goats.filter((g) => g.farmerId === farmerId);
    if (status) {
      filtered = filtered.filter((g) => g.status === status);
    }
    // Sort by createdAt descending
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  let q: Query;
  if (status) {
    q = query(
      collection(db, 'goats'),
      where('farmerId', '==', farmerId),
      where('status', '==', status),
      orderBy('createdAt', 'desc')
    );
  } else {
    q = query(
      collection(db, 'goats'),
      where('farmerId', '==', farmerId),
      orderBy('createdAt', 'desc')
    );
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as Goat);
}

export async function deleteGoat(goatId: string): Promise<void> {
  if (useSheetsOrLocal()) {
    await indexedDB.deleteItem('goats', goatId);
    if (sheetsService.isSheetsConfigured()) {
      try {
        await sheetsService.deleteGoatSheet(goatId);
      } catch (err) {
        console.error('Error deleting goat from Google Sheets:', err);
      }
    }
    return;
  }

  await deleteDoc(doc(db, 'goats', goatId));
}

// Weight Record Services
export async function recordWeight(
  goatId: string,
  weightData: Omit<WeightRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();
  const record: WeightRecord = {
    ...weightData,
    id,
    goatId,
    isRecorded: true,
    createdAt: now,
    updatedAt: now,
  };

  if (useSheetsOrLocal()) {
    await indexedDB.addItem('weights', record);
    if (sheetsService.isSheetsConfigured()) {
      try {
        await sheetsService.writeWeightSheet(record);
      } catch (err) {
        console.error('Error syncing weight to Google Sheets:', err);
      }
    }
    return id;
  }

  await setDoc(doc(db, 'weights', id), record);
  return id;
}

export async function getGoatWeights(goatId: string): Promise<WeightRecord[]> {
  if (useSheetsOrLocal()) {
    let weights: WeightRecord[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        weights = await sheetsService.getWeightsSheet();
        // Cache locally
        for (const w of weights) {
          await indexedDB.updateItem('weights', w);
        }
      } catch (err) {
        console.error('Error fetching weights from Google Sheets:', err);
        weights = await indexedDB.getAllItems<WeightRecord>('weights');
      }
    } else {
      weights = await indexedDB.getAllItems<WeightRecord>('weights');
    }

    return weights.filter((w) => w.goatId === goatId).sort((a, b) => a.weightNumber - b.weightNumber);
  }

  const q = query(
    collection(db, 'weights'),
    where('goatId', '==', goatId),
    orderBy('weightNumber', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as WeightRecord);
}

export async function getWeightRecord(goatId: string, weightNumber: number): Promise<WeightRecord | null> {
  if (useSheetsOrLocal()) {
    let weights: WeightRecord[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        weights = await sheetsService.getWeightsSheet();
        for (const w of weights) {
          await indexedDB.updateItem('weights', w);
        }
      } catch (err) {
        console.error('Error fetching weights from Google Sheets:', err);
        weights = await indexedDB.getAllItems<WeightRecord>('weights');
      }
    } else {
      weights = await indexedDB.getAllItems<WeightRecord>('weights');
    }

    return weights.find((w) => w.goatId === goatId && w.weightNumber === weightNumber) || null;
  }

  const q = query(
    collection(db, 'weights'),
    where('goatId', '==', goatId),
    where('weightNumber', '==', weightNumber)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as WeightRecord);
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
      try {
        await sheetsService.writeDewormingSheet(record);
      } catch (err) {
        console.error('Error syncing deworming to Google Sheets:', err);
      }
    }
    return id;
  }

  await setDoc(doc(db, 'deworming', id), record);
  return id;
}

export async function getGoatDeworming(goatId: string): Promise<DewormingRecord | null> {
  if (useSheetsOrLocal()) {
    let records: DewormingRecord[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        records = await sheetsService.getDewormingSheet();
        for (const r of records) {
          await indexedDB.updateItem('deworming', r);
        }
      } catch (err) {
        console.error('Error fetching deworming from Google Sheets:', err);
        records = await indexedDB.getAllItems<DewormingRecord>('deworming');
      }
    } else {
      records = await indexedDB.getAllItems<DewormingRecord>('deworming');
    }

    return records.find((r) => r.goatId === goatId) || null;
  }

  const q = query(
    collection(db, 'deworming'),
    where('goatId', '==', goatId)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as DewormingRecord);
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
      try {
        await sheetsService.writeVaccinationSheet(record);
      } catch (err) {
        console.error('Error syncing vaccination to Google Sheets:', err);
      }
    }
    return id;
  }

  await setDoc(doc(db, 'vaccination', id), record);
  return id;
}

export async function getGoatVaccination(goatId: string): Promise<PPRVaccinationRecord | null> {
  if (useSheetsOrLocal()) {
    let records: PPRVaccinationRecord[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        records = await sheetsService.getVaccinationSheet();
        for (const r of records) {
          await indexedDB.updateItem('vaccination', r);
        }
      } catch (err) {
        console.error('Error fetching vaccination from Google Sheets:', err);
        records = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
      }
    } else {
      records = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
    }

    return records.find((r) => r.goatId === goatId) || null;
  }

  const q = query(
    collection(db, 'vaccination'),
    where('goatId', '==', goatId)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as PPRVaccinationRecord);
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
    // Update goat status to sold
    await updateGoat(goatId, { status: 'sold', saleInfo: sale });
    await indexedDB.addItem('sales', sale);

    if (sheetsService.isSheetsConfigured()) {
      try {
        await sheetsService.writeSaleSheet(sale);
      } catch (err) {
        console.error('Error syncing sale to Google Sheets:', err);
      }
    }
    return id;
  }

  await updateGoat(goatId, { status: 'sold', saleInfo: { ...saleData, id, createdAt: now, updatedAt: now } });

  await setDoc(doc(db, 'sales', id), {
    ...saleData,
    id,
    goatId,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function getSaleInfo(goatId: string): Promise<SaleInfo | null> {
  if (useSheetsOrLocal()) {
    let sales: SaleInfo[] = [];
    if (sheetsService.isSheetsConfigured()) {
      try {
        sales = await sheetsService.getSalesSheet();
        for (const s of sales) {
          await indexedDB.updateItem('sales', s);
        }
      } catch (err) {
        console.error('Error fetching sales from Google Sheets:', err);
        sales = await indexedDB.getAllItems<SaleInfo>('sales');
      }
    } else {
      sales = await indexedDB.getAllItems<SaleInfo>('sales');
    }

    return sales.find((s) => s.goatId === goatId) || null;
  }

  const q = query(
    collection(db, 'sales'),
    where('goatId', '==', goatId)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as SaleInfo);
}

// Search and filter
export async function searchGoats(farmerId: string, searchTerm: string): Promise<Goat[]> {
  const allGoats = await getFarmerGoats(farmerId);

  return allGoats.filter(
    (goat) =>
      goat.earTagNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      goat.variant.toLowerCase().includes(searchTerm.toLowerCase()) ||
      goat.sellerName?.toLowerCase().includes(searchTerm.toLowerCase())
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
