import ExcelJS from 'exceljs';
import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo } from '@/types';
import { buildGoatRow, buildWeightRow, buildDewormRow, buildVaccRow } from '@/utils/reconRows';

// ─── Shared Helpers ───────────────────────────────────────────────────────────

const parseDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  const d = new Date(val.toString());
  return isNaN(d.getTime()) ? new Date() : d;
};

const parseNum = (val: any, fallback = 0): number => {
  const n = parseFloat(val?.toString() ?? '');
  return isNaN(n) ? fallback : n;
};

function styleHeader(row: ExcelJS.Row, color = 'FF10B981') {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  row.alignment = { vertical: 'middle', horizontal: 'left' };
  row.height = 22;
}

function getCellVal(row: ExcelJS.Row, colIndices: Record<string, number>, header: string): any {
  const idx = colIndices[header];
  if (!idx) return undefined;
  const cell = row.getCell(idx);
  const val = cell.value;
  if (val && typeof val === 'object') {
    if ('result' in val) return (val as any).result;
    if ('text' in val) return (val as any).text;
  }
  return val;
}

function buildColIndex(worksheet: ExcelJS.Worksheet): Record<string, number> {
  const map: Record<string, number> = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    const v = cell.value?.toString().trim();
    if (v) map[v] = col;
  });
  return map;
}

/** Maps every data row (skipping the header) of a worksheet through `mapRow`,
 *  which receives a `get(columnHeader)` accessor and returns either a parsed
 *  record or null to skip that row (e.g. missing ear tag). */
function mapRows<T>(worksheet: ExcelJS.Worksheet, mapRow: (get: (header: string) => any) => T | null): T[] {
  const colIdx = buildColIndex(worksheet);
  const results: T[] = [];
  worksheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const get = (header: string) => getCellVal(row, colIdx, header);
    const mapped = mapRow(get);
    if (mapped) results.push(mapped);
  });
  return results;
}

// ─── Export Interfaces ────────────────────────────────────────────────────────

export interface ExportDataBundle {
  goats: Goat[];
  weights: WeightRecord[];
  dewormings: DewormingRecord[];
  vaccinations: PPRVaccinationRecord[];
  sales: SaleInfo[];
}

// ─── Import Interfaces ────────────────────────────────────────────────────────

export interface ImportedGoatData extends Omit<Goat, 'id' | 'createdAt' | 'updatedAt' | 'farmerId' | 'qrCode' | 'barcode'> {
  vaccinationStatus?: 'vaccinated' | 'unvaccinated';
  dewormingStatus?: 'dewormed' | 'not done';
  saleWeight?: number;
  saleRatePerKg?: number;
  saleDate?: Date;
  remarks?: string;
}

export interface ImportedWeightData {
  earTagNumber: string;
  weightNumber: number;
  weight: number;
  recordedDate?: Date;
  dueDate?: Date;
  remarks?: string;
}

export interface ImportedDewormingData {
  earTagNumber: string;
  dewormingDate: Date;
  roundNumber?: number;
  medicineUsed?: string;
  administeredBy?: string;
  batchNumber?: string;
  remarks?: string;
}

export interface ImportedVaccinationData {
  earTagNumber: string;
  vaccinationDate: Date;
  roundNumber?: number;
  vaccineBrand?: string;
  administeredBy?: string;
  batchNumber?: string;
  remarks?: string;
}

export interface FullImportResult {
  goats: ImportedGoatData[];
  weights: ImportedWeightData[];
  dewormings: ImportedDewormingData[];
  vaccinations: ImportedVaccinationData[];
}

// ─── Column Definitions ───────────────────────────────────────────────────────

const GOAT_COLS = {
  earTagNumber:  'Goat Number (Ear Tag)',
  variant:       'Variant/Breed',
  gender:        'Gender',
  purchaseDate:  'Purchase Date',
  purchaseWeight:'Purchase Weight (kg)',
  purchasePrice: 'Purchase Price (₹)',
  sellerName:    'Seller Name',
  vaccination:   'Vaccination Status',
  deworming:     'Deworming Status',
  status:        'Status',
  saleWeight:    'Sale Weight (kg)',
  saleRatePerKg: 'Sale Rate (₹/kg)',
  saleAmount:    'Sale Amount (₹)',
  netProfit:     'Net Profit (₹)',
  notes:         'Notes',
};

const WEIGHT_COLS = {
  earTagNumber:  'Goat Number (Ear Tag)',
  weightNumber:  'Weight # (0=Purchase)',
  weight:        'Weight (kg)',
  recordedDate:  'Recorded Date',
  dueDate:       'Due Date',
  weightGain:    'Weight Gain (kg)',
  remarks:       'Remarks',
};

const DEWORM_COLS = {
  earTagNumber:  'Goat Number (Ear Tag)',
  roundNumber:   'Round #',
  dewormingDate: 'Deworming Date',
  medicineUsed:  'Medicine Used',
  administeredBy:'Administered By',
  batchNumber:   'Batch Number',
  remarks:       'Remarks',
};

const VACC_COLS = {
  earTagNumber:  'Goat Number (Ear Tag)',
  roundNumber:   'Round #',
  vaccinationDate:'Vaccination Date',
  vaccineBrand:  'Vaccine Brand',
  administeredBy:'Administered By',
  batchNumber:   'Batch Number',
  remarks:       'Remarks',
};

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export async function exportGoatsToExcel(bundle: ExportDataBundle): Promise<void> {
  const { goats, weights, dewormings, vaccinations, sales } = bundle;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GOATIE';
  workbook.created = new Date();

  // Build a map earTag lookup from goatId
  const goatById = new Map<string, Goat>(goats.map((g) => [g.id, g]));

  // ── Sheet 1: Goats Data ────────────────────────────────────────────────────
  const goatSheet = workbook.addWorksheet('Goats Data');
  goatSheet.columns = [
    { header: GOAT_COLS.earTagNumber,   key: 'earTagNumber',   width: 25 },
    { header: GOAT_COLS.variant,        key: 'variant',        width: 20 },
    { header: GOAT_COLS.gender,         key: 'gender',         width: 12 },
    { header: GOAT_COLS.purchaseDate,   key: 'purchaseDate',   width: 18 },
    { header: GOAT_COLS.purchaseWeight, key: 'purchaseWeight', width: 22 },
    { header: GOAT_COLS.purchasePrice,  key: 'purchasePrice',  width: 20 },
    { header: GOAT_COLS.sellerName,     key: 'sellerName',     width: 22 },
    { header: GOAT_COLS.vaccination,    key: 'vaccination',    width: 20 },
    { header: GOAT_COLS.deworming,      key: 'deworming',      width: 20 },
    { header: GOAT_COLS.status,         key: 'status',         width: 15 },
    { header: GOAT_COLS.saleWeight,     key: 'saleWeight',     width: 15 },
    { header: GOAT_COLS.saleRatePerKg,  key: 'saleRatePerKg',  width: 18 },
    { header: GOAT_COLS.saleAmount,     key: 'saleAmount',     width: 18 },
    { header: GOAT_COLS.netProfit,      key: 'netProfit',      width: 18 },
    { header: GOAT_COLS.notes,          key: 'notes',          width: 30 },
  ];
  styleHeader(goatSheet.getRow(1), 'FF10B981');

  const vaccSet = new Set(vaccinations.map((v) => v.goatId));
  const dewormSet = new Set(dewormings.map((d) => d.goatId));

  goats.forEach((goat) => {
    const sale = sales.find((s) => s.goatId === goat.id) ?? goat.saleInfo;
    goatSheet.addRow(buildGoatRow(goat, sale, vaccSet.has(goat.id), dewormSet.has(goat.id)));
  });

  // ── Sheet 2: Monthly Weights ───────────────────────────────────────────────
  const wSheet = workbook.addWorksheet('Monthly Weights');
  wSheet.columns = [
    { header: WEIGHT_COLS.earTagNumber,  key: 'earTagNumber',  width: 25 },
    { header: WEIGHT_COLS.weightNumber,  key: 'weightNumber',  width: 22 },
    { header: WEIGHT_COLS.weight,        key: 'weight',        width: 15 },
    { header: WEIGHT_COLS.recordedDate,  key: 'recordedDate',  width: 18 },
    { header: WEIGHT_COLS.dueDate,       key: 'dueDate',       width: 18 },
    { header: WEIGHT_COLS.weightGain,    key: 'weightGain',    width: 18 },
    { header: WEIGHT_COLS.remarks,       key: 'remarks',       width: 30 },
  ];
  styleHeader(wSheet.getRow(1), 'FF3B82F6');

  weights
    .filter((w) => w.isRecorded && w.weight > 0)
    .sort((a, b) => {
      const tagA = goatById.get(a.goatId)?.earTagNumber ?? '';
      const tagB = goatById.get(b.goatId)?.earTagNumber ?? '';
      return tagA.localeCompare(tagB) || a.weightNumber - b.weightNumber;
    })
    .forEach((w) => {
      wSheet.addRow(buildWeightRow(w, goatById.get(w.goatId)?.earTagNumber ?? w.goatId));
    });

  // ── Sheet 3: Deworming ─────────────────────────────────────────────────────
  const dSheet = workbook.addWorksheet('Deworming');
  dSheet.columns = [
    { header: DEWORM_COLS.earTagNumber,   key: 'earTagNumber',   width: 25 },
    { header: DEWORM_COLS.roundNumber,    key: 'roundNumber',    width: 12 },
    { header: DEWORM_COLS.dewormingDate,  key: 'dewormingDate',  width: 18 },
    { header: DEWORM_COLS.medicineUsed,   key: 'medicineUsed',   width: 22 },
    { header: DEWORM_COLS.administeredBy, key: 'administeredBy', width: 22 },
    { header: DEWORM_COLS.batchNumber,    key: 'batchNumber',    width: 18 },
    { header: DEWORM_COLS.remarks,        key: 'remarks',        width: 30 },
  ];
  styleHeader(dSheet.getRow(1), 'FFF59E0B');

  dewormings
    .sort((a, b) => {
      const tagA = goatById.get(a.goatId)?.earTagNumber ?? '';
      const tagB = goatById.get(b.goatId)?.earTagNumber ?? '';
      return tagA.localeCompare(tagB) || (a.roundNumber ?? 0) - (b.roundNumber ?? 0);
    })
    .forEach((d) => {
      dSheet.addRow(buildDewormRow(d, goatById.get(d.goatId)?.earTagNumber ?? d.goatId));
    });

  // ── Sheet 4: Vaccination ───────────────────────────────────────────────────
  const vSheet = workbook.addWorksheet('Vaccination');
  vSheet.columns = [
    { header: VACC_COLS.earTagNumber,   key: 'earTagNumber',   width: 25 },
    { header: VACC_COLS.roundNumber,    key: 'roundNumber',    width: 12 },
    { header: VACC_COLS.vaccinationDate,key: 'vaccinationDate',width: 18 },
    { header: VACC_COLS.vaccineBrand,   key: 'vaccineBrand',   width: 22 },
    { header: VACC_COLS.administeredBy, key: 'administeredBy', width: 22 },
    { header: VACC_COLS.batchNumber,    key: 'batchNumber',    width: 18 },
    { header: VACC_COLS.remarks,        key: 'remarks',        width: 30 },
  ];
  styleHeader(vSheet.getRow(1), 'FFE879A0');

  vaccinations
    .sort((a, b) => {
      const tagA = goatById.get(a.goatId)?.earTagNumber ?? '';
      const tagB = goatById.get(b.goatId)?.earTagNumber ?? '';
      return tagA.localeCompare(tagB) || (a.roundNumber ?? 0) - (b.roundNumber ?? 0);
    })
    .forEach((v) => {
      vSheet.addRow(buildVaccRow(v, goatById.get(v.goatId)?.earTagNumber ?? v.goatId));
    });

  // ── Download ───────────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `goatie_export_${new Date().toISOString().split('T')[0]}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

// ─── IMPORT ───────────────────────────────────────────────────────────────────

export async function importFullExcelData(file: File): Promise<FullImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = async (e) => {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(e.target!.result as ArrayBuffer);

        // ── Goats Sheet ──────────────────────────────────────────────────────
        const goats: ImportedGoatData[] = [];
        const goatWs = workbook.getWorksheet('Goats Data') ?? workbook.worksheets[0];
        if (!goatWs) throw new Error('No "Goats Data" sheet found');

        const requiredGoatCols = [
          GOAT_COLS.earTagNumber, GOAT_COLS.variant, GOAT_COLS.gender,
          GOAT_COLS.purchaseDate, GOAT_COLS.purchaseWeight, GOAT_COLS.purchasePrice,
        ];
        const goatIdx = buildColIndex(goatWs);
        for (const req of requiredGoatCols) {
          if (!goatIdx[req]) throw new Error(`Required column "${req}" missing in Goats Data sheet`);
        }

        goats.push(...mapRows<ImportedGoatData>(goatWs, (get) => {
          const earTag = get(GOAT_COLS.earTagNumber)?.toString().trim();
          if (!earTag) return null;

          let gender = get(GOAT_COLS.gender)?.toString().trim().toLowerCase();
          if (gender !== 'female' && gender !== 'male') gender = 'male';

          let status = get(GOAT_COLS.status)?.toString().trim().toLowerCase();
          if (!['active', 'sold', 'deceased'].includes(status ?? '')) status = 'active';

          const vaccVal = get(GOAT_COLS.vaccination)?.toString().trim().toLowerCase();
          const dewVal  = get(GOAT_COLS.deworming)?.toString().trim().toLowerCase();
          const saleWeightV  = get(GOAT_COLS.saleWeight);
          const saleRateV    = get(GOAT_COLS.saleRatePerKg);

          return {
            earTagNumber:    earTag,
            variant:         get(GOAT_COLS.variant)?.toString().trim() || 'LOCAL',
            gender:          gender as 'male' | 'female',
            purchaseDate:    parseDate(get(GOAT_COLS.purchaseDate)),
            purchaseWeight:  parseNum(get(GOAT_COLS.purchaseWeight)),
            purchasePrice:   parseNum(get(GOAT_COLS.purchasePrice)),
            sellerName:      get(GOAT_COLS.sellerName)?.toString().trim() || 'N/A',
            notes:           get(GOAT_COLS.notes)?.toString().trim() || undefined,
            status:          status as 'active' | 'sold' | 'deceased',
            vaccinationStatus: vaccVal === 'vaccinated' ? 'vaccinated' : 'unvaccinated',
            dewormingStatus:   dewVal === 'dewormed' ? 'dewormed' : 'not done',
            saleWeight:      saleWeightV ? parseNum(saleWeightV) : undefined,
            saleRatePerKg:   saleRateV ? parseNum(saleRateV) : undefined,
          };
        }));

        // ── Weights Sheet ────────────────────────────────────────────────────
        const wWs = workbook.getWorksheet('Monthly Weights');
        const weights: ImportedWeightData[] = wWs ? mapRows<ImportedWeightData>(wWs, (get) => {
          const earTag = get(WEIGHT_COLS.earTagNumber)?.toString().trim();
          const weightVal = parseNum(get(WEIGHT_COLS.weight));
          if (!earTag || weightVal <= 0) return null;
          return {
            earTagNumber: earTag,
            weightNumber: parseNum(get(WEIGHT_COLS.weightNumber), 0),
            weight:       weightVal,
            recordedDate: parseDate(get(WEIGHT_COLS.recordedDate)),
            dueDate:      parseDate(get(WEIGHT_COLS.dueDate)),
            remarks:      get(WEIGHT_COLS.remarks)?.toString().trim() || undefined,
          };
        }) : [];

        // ── Deworming Sheet ──────────────────────────────────────────────────
        const dWs = workbook.getWorksheet('Deworming');
        const dewormings: ImportedDewormingData[] = dWs ? mapRows<ImportedDewormingData>(dWs, (get) => {
          const earTag = get(DEWORM_COLS.earTagNumber)?.toString().trim();
          if (!earTag) return null;
          return {
            earTagNumber:   earTag,
            dewormingDate:  parseDate(get(DEWORM_COLS.dewormingDate)),
            roundNumber:    parseNum(get(DEWORM_COLS.roundNumber)) || undefined,
            medicineUsed:   get(DEWORM_COLS.medicineUsed)?.toString().trim() || undefined,
            administeredBy: get(DEWORM_COLS.administeredBy)?.toString().trim() || undefined,
            batchNumber:    get(DEWORM_COLS.batchNumber)?.toString().trim() || undefined,
            remarks:        get(DEWORM_COLS.remarks)?.toString().trim() || undefined,
          };
        }) : [];

        // ── Vaccination Sheet ────────────────────────────────────────────────
        const vWs = workbook.getWorksheet('Vaccination');
        const vaccinations: ImportedVaccinationData[] = vWs ? mapRows<ImportedVaccinationData>(vWs, (get) => {
          const earTag = get(VACC_COLS.earTagNumber)?.toString().trim();
          if (!earTag) return null;
          return {
            earTagNumber:    earTag,
            vaccinationDate: parseDate(get(VACC_COLS.vaccinationDate)),
            roundNumber:     parseNum(get(VACC_COLS.roundNumber)) || undefined,
            vaccineBrand:    get(VACC_COLS.vaccineBrand)?.toString().trim() || undefined,
            administeredBy:  get(VACC_COLS.administeredBy)?.toString().trim() || undefined,
            batchNumber:     get(VACC_COLS.batchNumber)?.toString().trim() || undefined,
            remarks:         get(VACC_COLS.remarks)?.toString().trim() || undefined,
          };
        }) : [];

        resolve({ goats, weights, dewormings, vaccinations });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Legacy single-sheet import (kept for backward compat) ───────────────────

export async function importGoatsFromExcel(file: File): Promise<ImportedGoatData[]> {
  const result = await importFullExcelData(file);
  return result.goats;
}
