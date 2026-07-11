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
import { showToast } from '@/components/common/Toast';

// Determine if we should route to Sheets/IndexedDB instead of Firestore
const useSheetsOrLocal = (): boolean => {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  const isDemo = cachedDemoUser !== null;
  return isDemo || !db || sheetsService.isSheetsConfigured();
};

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

  // Generate weightNumber 1-4 placeholders (unrecorded, with monthly due dates)
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

    // Sync with Google Sheets — await to ensure data is saved before returning
    if (sheetsService.isSheetsConfigured()) {
      try {
        await sheetsService.writeGoatSheet(goat);
        await sheetsService.writeWeightSheet(w0);
        for (const w of placeholders) {
          await sheetsService.writeWeightSheet(w);
        }
      } catch (err) {
        console.error('Error syncing createGoat to Google Sheets:', err);
        showToast('warning', 'Google Sheets Sync Warning', 'Goat is saved locally, but failed to sync to Google Sheets. Ensure your Web App has permissions set to "Anyone".');
      }
    }
    return id;
  }

  // Firestore fallback
  await setDoc(doc(db, 'goats', id), goat);
  await setDoc(doc(db, 'weights', w0.id), w0);
  for (const w of placeholders) {
    await setDoc(doc(db, 'weights', w.id), w);
  }
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
    // Fetch fresh from Sheets if configured
    if (sheetsService.isSheetsConfigured()) {
      try {
        const goats = await sheetsService.getGoatsSheet();
        const fresh = goats.find((g) => g.id === goatId);
        if (fresh) {
          await indexedDB.updateItem('goats', fresh);
          return fresh;
        }
      } catch (err) {
        console.error('Error fetching goat from Google Sheets:', err);
      }
    }
    // Fallback to IndexedDB
    return await indexedDB.getItem<Goat>('goats', goatId) || null;
  }

  const snapshot = await getDoc(doc(db, 'goats', goatId));
  return snapshot.exists() ? (snapshot.data() as Goat) : null;
}

export async function getGoatByEarTag(farmerId: string, earTagNumber: string): Promise<Goat | null> {
  if (useSheetsOrLocal()) {
    // Fetch from Sheets for accuracy
    if (sheetsService.isSheetsConfigured()) {
      try {
        const freshGoats = await sheetsService.getGoatsSheet();
        // Only block if there's an ACTIVE goat with this tag (sold ones can be reused)
        const match = freshGoats.find(
          (g) => g.farmerId === farmerId && g.earTagNumber === earTagNumber && g.status === 'active'
        ) || null;
        // Update local cache
        for (const g of freshGoats) {
          await indexedDB.updateItem('goats', g);
        }
        return match;
      } catch (err) {
        console.error('Error fetching goats for ear tag check:', err);
      }
    }
    const goats = await indexedDB.getAllItems<Goat>('goats');
    // Only block reuse if the goat is active
    return goats.find((g) => g.farmerId === farmerId && g.earTagNumber === earTagNumber && g.status === 'active') || null;
  }

  const q = query(
    collection(db, 'goats'),
    where('farmerId', '==', farmerId),
    where('earTagNumber', '==', earTagNumber),
    where('status', '==', 'active')
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Goat);
}

export async function getFarmerGoats(farmerId: string, status?: 'active' | 'sold' | 'deceased'): Promise<Goat[]> {
  if (useSheetsOrLocal()) {
    // Fetch fresh from Sheets when configured
    if (sheetsService.isSheetsConfigured()) {
      try {
        const freshGoats = await sheetsService.getGoatsSheet();
        const localGoats = await indexedDB.getAllItems<Goat>('goats');
        
        // Find goats created locally while Sheets was unconfigured/offline
        const unsyncedGoats = localGoats.filter(
          (lg) => lg.farmerId === farmerId && !freshGoats.some((fg) => fg.id === lg.id)
        );

        if (unsyncedGoats.length > 0) {
          for (const ug of unsyncedGoats) {
            try {
              // 1. Sync goat
              await sheetsService.writeGoatSheet(ug);

              // 2. Sync weights
              const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
              const ugWeights = localWeights.filter((w) => w.goatId === ug.id);
              for (const uw of ugWeights) {
                await sheetsService.writeWeightSheet(uw);
              }

              // 3. Sync dewormings
              const localDewormings = await indexedDB.getAllItems<DewormingRecord>('deworming');
              const ugDewormings = localDewormings.filter((d) => d.goatId === ug.id);
              for (const ud of ugDewormings) {
                await sheetsService.writeDewormingSheet(ud);
              }

              // 4. Sync vaccinations
              const localVaccinations = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
              const ugVaccinations = localVaccinations.filter((v) => v.goatId === ug.id);
              for (const uv of ugVaccinations) {
                await sheetsService.writeVaccinationSheet(uv);
              }

              // 5. Sync sale if sold
              if (ug.status === 'sold' && ug.saleInfo) {
                await sheetsService.writeSaleSheet(ug.saleInfo);
              }

              freshGoats.push(ug);
            } catch (syncErr) {
              console.error(`Failed to sync local goat ${ug.earTagNumber} to sheets:`, syncErr);
            }
          }
        }

        // Also check for any unsynced weights/vaccinations/dewormings on existing goats
        try {
          const freshWeights = await sheetsService.getWeightsSheet();
          const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
          const unsyncedWeights = localWeights.filter(
            (lw) => lw.isRecorded && 
                    freshGoats.some((g) => g.id === lw.goatId && g.farmerId === farmerId) && 
                    !freshWeights.some((fw) => fw.id === lw.id)
          );
          for (const uw of unsyncedWeights) {
            await sheetsService.writeWeightSheet(uw).catch(() => {});
          }

          const freshDewormings = await sheetsService.getDewormingSheet();
          const localDewormings = await indexedDB.getAllItems<DewormingRecord>('deworming');
          const unsyncedDewormings = localDewormings.filter(
            (ld) => freshGoats.some((g) => g.id === ld.goatId && g.farmerId === farmerId) && 
                    !freshDewormings.some((fd) => fd.id === ld.id)
          );
          for (const ud of unsyncedDewormings) {
            await sheetsService.writeDewormingSheet(ud).catch(() => {});
          }

          const freshVaccinations = await sheetsService.getVaccinationSheet();
          const localVaccinations = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
          const unsyncedVaccinations = localVaccinations.filter(
            (lv) => freshGoats.some((g) => g.id === lv.goatId && g.farmerId === farmerId) && 
                    !freshVaccinations.some((fv) => fv.id === lv.id)
          );
          for (const uv of unsyncedVaccinations) {
            await sheetsService.writeVaccinationSheet(uv).catch(() => {});
          }
        } catch (subSyncErr) {
          console.error('Error syncing individual records:', subSyncErr);
        }

        // Update IndexedDB with fresh data
        const otherFarmers = localGoats.filter((g) => g.farmerId !== farmerId);
        await indexedDB.clearStore('goats');
        for (const g of [...otherFarmers, ...freshGoats.filter((g) => g.farmerId === farmerId)]) {
          await indexedDB.updateItem('goats', g);
        }
        let filtered = freshGoats.filter((g) => g.farmerId === farmerId);
        if (status) filtered = filtered.filter((g) => g.status === status);
        return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } catch (err) {
        console.error('Error fetching farmer goats from Sheets:', err);
        showToast('error', 'Google Sheets Fetch Failed', 'Could not read from Google Sheets. Ensure your Web App is deployed with public access (Anyone). Falling back to local offline cache.');
      }
    }

    // Fallback to IndexedDB
    const localGoats = await indexedDB.getAllItems<Goat>('goats');
    let filtered = localGoats.filter((g) => g.farmerId === farmerId);
    if (status) filtered = filtered.filter((g) => g.status === status);
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

// ─── Weight Record Services ───────────────────────────────────────────────────

export async function recordWeight(
  goatId: string,
  weightData: Omit<WeightRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date();

  if (useSheetsOrLocal()) {
    // Fetch previous recorded weight to compute gain
    const allWeights = sheetsService.isSheetsConfigured()
      ? await sheetsService.getWeightsSheet().catch(() => indexedDB.getAllItems<WeightRecord>('weights'))
      : await indexedDB.getAllItems<WeightRecord>('weights');

    const goatWeights = (allWeights as WeightRecord[])
      .filter((w) => w.goatId === goatId && w.isRecorded && w.weight > 0)
      .sort((a, b) => a.weightNumber - b.weightNumber);

    // Previous weight is the last recorded one before this weight number
    const prevWeight = goatWeights
      .filter((w) => w.weightNumber < weightData.weightNumber)
      .pop();

    const weightGain = prevWeight ? parseFloat((weightData.weight - prevWeight.weight).toFixed(2)) : undefined;

    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    const existing = localWeights.find((w) => w.goatId === goatId && w.weightNumber === weightData.weightNumber);

    if (existing) {
      const updated: WeightRecord = {
        ...existing,
        weight: weightData.weight,
        recordedDate: weightData.recordedDate || now,
        remarks: weightData.remarks,
        isRecorded: true,
        weightGain,
        updatedAt: now,
      };
      await indexedDB.updateItem('weights', updated);
      if (sheetsService.isSheetsConfigured()) {
        try {
          await sheetsService.updateWeightSheet(updated);
        } catch (err) {
          console.error('Error updating weight in Google Sheets:', err);
        }
      }
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
  }

  // Firestore fallback
  const q = query(
    collection(db, 'weights'),
    where('goatId', '==', goatId),
    where('weightNumber', '==', weightData.weightNumber)
  );
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    const docRef = doc(db, 'weights', snapshot.docs[0].id);
    const existingData = snapshot.docs[0].data() as WeightRecord;
    const updated = {
      ...existingData,
      weight: weightData.weight,
      recordedDate: weightData.recordedDate || now,
      remarks: weightData.remarks,
      isRecorded: true,
      updatedAt: now,
    };
    await setDoc(docRef, updated);
    return snapshot.docs[0].id;
  }

  const id = generateId();
  const record: WeightRecord = {
    ...weightData,
    id,
    goatId,
    isRecorded: true,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'weights', id), record);
  return id;
}

export async function getGoatWeights(goatId: string): Promise<WeightRecord[]> {
  if (useSheetsOrLocal()) {
    if (sheetsService.isSheetsConfigured()) {
      try {
        const freshWeights = await sheetsService.getWeightsSheet();
        for (const w of freshWeights) {
          await indexedDB.updateItem('weights', w);
        }
        return freshWeights.filter((w) => w.goatId === goatId).sort((a, b) => a.weightNumber - b.weightNumber);
      } catch (err) {
        console.error('Error fetching weights from Sheets:', err);
      }
    }
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    return localWeights.filter((w) => w.goatId === goatId).sort((a, b) => a.weightNumber - b.weightNumber);
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
    if (sheetsService.isSheetsConfigured()) {
      try {
        const freshWeights = await sheetsService.getWeightsSheet();
        return freshWeights.find((w) => w.goatId === goatId && w.weightNumber === weightNumber) || null;
      } catch (err) {
        console.error('Error fetching weight record from Sheets:', err);
      }
    }
    const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
    return localWeights.find((w) => w.goatId === goatId && w.weightNumber === weightNumber) || null;
  }

  const q = query(
    collection(db, 'weights'),
    where('goatId', '==', goatId),
    where('weightNumber', '==', weightNumber)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as WeightRecord);
}

// ─── Deworming Services ───────────────────────────────────────────────────────

export async function recordDeworming(
  goatId: string,
  data: Omit<DewormingRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();

  // Determine round number
  const existingRecords = await getAllDewormingForGoat(goatId);
  const roundNumber = (data.roundNumber) || existingRecords.length + 1;

  const record: DewormingRecord = {
    ...data,
    id,
    goatId,
    roundNumber,
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

export async function getAllDewormingForGoat(goatId: string): Promise<DewormingRecord[]> {
  if (useSheetsOrLocal()) {
    if (sheetsService.isSheetsConfigured()) {
      try {
        const all = await sheetsService.getDewormingSheet();
        return all.filter((r) => r.goatId === goatId).sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
      } catch (err) {
        console.error('Error fetching deworming from Sheets:', err);
      }
    }
    const local = await indexedDB.getAllItems<DewormingRecord>('deworming');
    return local.filter((r) => r.goatId === goatId).sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
  }
  const q = query(collection(db, 'deworming'), where('goatId', '==', goatId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as DewormingRecord);
}

export async function getGoatDeworming(goatId: string): Promise<DewormingRecord | null> {
  const all = await getAllDewormingForGoat(goatId);
  return all.length > 0 ? all[all.length - 1] : null;
}

// ─── PPR Vaccination Services ─────────────────────────────────────────────────

export async function recordVaccination(
  goatId: string,
  data: Omit<PPRVaccinationRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId();
  const now = new Date();

  // Determine round number
  const existingRecords = await getAllVaccinationsForGoat(goatId);
  const roundNumber = (data.roundNumber) || existingRecords.length + 1;

  const record: PPRVaccinationRecord = {
    ...data,
    id,
    goatId,
    roundNumber,
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

export async function getAllVaccinationsForGoat(goatId: string): Promise<PPRVaccinationRecord[]> {
  if (useSheetsOrLocal()) {
    if (sheetsService.isSheetsConfigured()) {
      try {
        const all = await sheetsService.getVaccinationSheet();
        return all.filter((r) => r.goatId === goatId).sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
      } catch (err) {
        console.error('Error fetching vaccinations from Sheets:', err);
      }
    }
    const local = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
    return local.filter((r) => r.goatId === goatId).sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
  }
  const q = query(collection(db, 'vaccination'), where('goatId', '==', goatId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as PPRVaccinationRecord);
}

export async function getGoatVaccination(goatId: string): Promise<PPRVaccinationRecord | null> {
  const all = await getAllVaccinationsForGoat(goatId);
  return all.length > 0 ? all[all.length - 1] : null;
}

// ─── Sale Services ────────────────────────────────────────────────────────────

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
    if (sheetsService.isSheetsConfigured()) {
      try {
        const freshSales = await sheetsService.getSalesSheet();
        for (const s of freshSales) {
          await indexedDB.updateItem('sales', s);
        }
        return freshSales.find((s) => s.goatId === goatId) || null;
      } catch (err) {
        console.error('Error fetching sales info from Sheets:', err);
      }
    }
    const localSales = await indexedDB.getAllItems<SaleInfo>('sales');
    return localSales.find((s) => s.goatId === goatId) || null;
  }

  const q = query(
    collection(db, 'sales'),
    where('goatId', '==', goatId)
  );

  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as SaleInfo);
}

// ─── Search and Filter ────────────────────────────────────────────────────────

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
  // Firestore fallback
  const snapshot = await getDocs(collection(db, 'deworming'));
  return snapshot.docs.map((doc) => doc.data() as DewormingRecord);
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
  // Firestore fallback
  const snapshot = await getDocs(collection(db, 'vaccination'));
  return snapshot.docs.map((doc) => doc.data() as PPRVaccinationRecord);
}
