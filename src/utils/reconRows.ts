import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo } from '@/types';

// Row shapes shared between the Excel export (excelHelper.ts) and the Google
// Sheets backup/reconciliation job (api/_lib/reconcile.ts), so both always
// agree on what a "row" looks like for each of the 4 tabs.

export const fmtDate = (d: Date | string | undefined | null): string => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
};

export interface ReconRow {
  id: string;
  [key: string]: any;
}

export function buildGoatRow(
  goat: Goat,
  sale: SaleInfo | undefined,
  vaccinated: boolean,
  dewormed: boolean
): ReconRow {
  return {
    id: goat.id,
    earTagNumber: goat.earTagNumber,
    variant: goat.variant,
    gender: goat.gender,
    purchaseDate: fmtDate(goat.purchaseDate),
    purchaseWeight: goat.purchaseWeight,
    purchasePrice: goat.purchasePrice,
    sellerName: goat.sellerName || '',
    vaccination: vaccinated ? 'Vaccinated' : 'Unvaccinated',
    deworming: dewormed ? 'Dewormed' : 'Not done',
    status: goat.status,
    saleWeight: sale?.saleWeight ?? '',
    saleRatePerKg: sale?.saleRatePerKg ?? '',
    saleAmount: sale?.saleAmount ?? '',
    netProfit: sale?.netProfit ?? '',
    notes: goat.notes || '',
  };
}

export function buildWeightRow(w: WeightRecord, earTagNumber: string): ReconRow {
  return {
    id: w.id,
    earTagNumber,
    weightNumber: w.weightNumber,
    weight: w.weight,
    recordedDate: fmtDate(w.recordedDate),
    dueDate: fmtDate(w.dueDate),
    weightGain: w.weightGain ?? '',
    remarks: w.remarks || '',
  };
}

export function buildDewormRow(d: DewormingRecord, earTagNumber: string): ReconRow {
  return {
    id: d.id,
    earTagNumber,
    roundNumber: d.roundNumber ?? '',
    dewormingDate: fmtDate(d.dewormingDate),
    medicineUsed: d.medicineUsed || '',
    administeredBy: d.administeredBy || '',
    batchNumber: d.batchNumber || '',
    remarks: d.remarks || '',
  };
}

export function buildVaccRow(v: PPRVaccinationRecord, earTagNumber: string): ReconRow {
  return {
    id: v.id,
    earTagNumber,
    roundNumber: v.roundNumber ?? '',
    vaccinationDate: fmtDate(v.vaccinationDate),
    vaccineBrand: v.vaccineBrand || '',
    administeredBy: v.administeredBy || '',
    batchNumber: v.batchNumber || '',
    remarks: v.remarks || '',
  };
}
