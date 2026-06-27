import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord, SaleInfo } from '@/types';

const WEBAPP_URL = import.meta.env.VITE_GOOGLE_SHEETS_WEBAPP_URL || '';

export function isSheetsConfigured(): boolean {
  return !!WEBAPP_URL && WEBAPP_URL.includes('script.google.com');
}

// CORS-safe fetch utility using text/plain payload to prevent preflight OPTIONS requests
async function callSheetsAPI(action: 'read' | 'write' | 'update' | 'delete' | 'batchWrite', sheetName: string, data?: any) {
  if (!isSheetsConfigured()) {
    throw new Error('Google Sheets Web App URL is not configured.');
  }

  if (action === 'read') {
    const url = `${WEBAPP_URL}?action=read&sheet=${sheetName}&_t=${Date.now()}`;
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
    });
    if (!response.ok) {
      throw new Error(`Failed to read from Google Sheet: ${response.statusText}`);
    }
    return await response.json();
  } else {
    // POST request with text/plain to bypass CORS preflight
    const response = await fetch(WEBAPP_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action,
        sheet: sheetName,
        data,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to write to Google Sheet: ${response.statusText}`);
    }
    return await response.json();
  }
}

// Helpers for date fields parsing
const GOAT_DATE_FIELDS = ['purchaseDate', 'createdAt', 'updatedAt'];
const WEIGHT_DATE_FIELDS = ['dueDate', 'recordedDate', 'createdAt', 'updatedAt'];
const DEWORMING_DATE_FIELDS = ['dewormingDate', 'createdAt', 'updatedAt'];
const VACCINATION_DATE_FIELDS = ['vaccinationDate', 'createdAt', 'updatedAt'];
const SALE_DATE_FIELDS = ['saleDate', 'createdAt', 'updatedAt'];

function parseItemDates<T>(item: any, dateFields: string[]): T {
  if (!item) return item;
  const parsed = { ...item };
  dateFields.forEach((field) => {
    if (parsed[field]) {
      parsed[field] = new Date(parsed[field]);
    }
  });
  return parsed as T;
}

// Goats Sheet
export async function getGoatsSheet(): Promise<Goat[]> {
  const data = await callSheetsAPI('read', 'goats');
  return data.map((item: any) => parseItemDates<Goat>(item, GOAT_DATE_FIELDS));
}

export async function writeGoatSheet(goat: Goat): Promise<void> {
  await callSheetsAPI('write', 'goats', goat);
}

export async function updateGoatSheet(goat: Goat): Promise<void> {
  await callSheetsAPI('update', 'goats', goat);
}

export async function deleteGoatSheet(id: string): Promise<void> {
  await callSheetsAPI('delete', 'goats', { id });
}

export async function batchWriteGoatsSheet(goats: Goat[]): Promise<void> {
  await callSheetsAPI('batchWrite', 'goats', goats);
}

// Weights Sheet
export async function getWeightsSheet(): Promise<WeightRecord[]> {
  const data = await callSheetsAPI('read', 'weights');
  return data.map((item: any) => parseItemDates<WeightRecord>(item, WEIGHT_DATE_FIELDS));
}

export async function writeWeightSheet(weight: WeightRecord): Promise<void> {
  await callSheetsAPI('write', 'weights', weight);
}

export async function updateWeightSheet(weight: WeightRecord): Promise<void> {
  await callSheetsAPI('update', 'weights', weight);
}

// Deworming Sheet
export async function getDewormingSheet(): Promise<DewormingRecord[]> {
  const data = await callSheetsAPI('read', 'deworming');
  return data.map((item: any) => parseItemDates<DewormingRecord>(item, DEWORMING_DATE_FIELDS));
}

export async function writeDewormingSheet(deworm: DewormingRecord): Promise<void> {
  await callSheetsAPI('write', 'deworming', deworm);
}

// Vaccination Sheet
export async function getVaccinationSheet(): Promise<PPRVaccinationRecord[]> {
  const data = await callSheetsAPI('read', 'vaccination');
  return data.map((item: any) => parseItemDates<PPRVaccinationRecord>(item, VACCINATION_DATE_FIELDS));
}

export async function writeVaccinationSheet(vacc: PPRVaccinationRecord): Promise<void> {
  await callSheetsAPI('write', 'vaccination', vacc);
}

// Sales Sheet
export async function getSalesSheet(): Promise<SaleInfo[]> {
  const data = await callSheetsAPI('read', 'sales');
  return data.map((item: any) => parseItemDates<SaleInfo>(item, SALE_DATE_FIELDS));
}

export async function writeSaleSheet(sale: SaleInfo): Promise<void> {
  await callSheetsAPI('write', 'sales', sale);
}
