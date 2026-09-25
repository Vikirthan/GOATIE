// Server-side row builders for the Master Sheets sync.
//
// INTENTIONAL duplicate of src/utils/reconRows.ts (client copy): api/
// functions are bundled by Vercel without the Vite `@/` alias and must not
// reach into src/. Importing '../../src/utils/reconRows' (which imports
// '@/types') crashes the function at load with FUNCTION_INVOCATION_FAILED.
// Keep both copies in sync — the shapes are covered by api/reconcile.test.ts.

export const fmtDate = (d: Date | string | undefined | null): string => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
};

export interface ReconRow {
  id: string;
  [key: string]: any;
}

// Minimal structural types so this file needs zero imports.
export interface ReconGoat {
  id: string;
  earTagNumber: string;
  variant: string;
  gender: string;
  purchaseDate: Date | string;
  purchaseWeight: number;
  purchasePrice: number;
  sellerName?: string;
  notes?: string;
  status: string;
}

export interface ReconSale {
  saleWeight?: number;
  saleRatePerKg?: number;
  saleAmount?: number;
  netProfit?: number;
}

export interface ReconWeight {
  id: string;
  weightNumber: number;
  weight: number;
  recordedDate?: Date | string;
  dueDate: Date | string;
  weightGain?: number | null;
  remarks?: string;
}

export interface ReconDeworm {
  id: string;
  roundNumber?: number | null;
  dewormingDate: Date | string;
  medicineUsed?: string;
  administeredBy?: string;
  batchNumber?: string;
  remarks?: string;
}

export interface ReconVacc {
  id: string;
  roundNumber?: number | null;
  vaccinationDate: Date | string;
  vaccineBrand?: string;
  administeredBy?: string;
  batchNumber?: string;
  remarks?: string;
}

export function buildGoatRow(
  goat: ReconGoat,
  sale: ReconSale | undefined,
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

export function buildWeightRow(w: ReconWeight, earTagNumber: string): ReconRow {
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

export function buildDewormRow(d: ReconDeworm, earTagNumber: string): ReconRow {
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

export function buildVaccRow(v: ReconVacc, earTagNumber: string): ReconRow {
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
