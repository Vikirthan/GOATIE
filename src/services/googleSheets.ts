import { GoatVariant, Language } from '@/types';

const GOOGLE_SHEETS_API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
const GOOGLE_SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID;

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

// Fetch data from Google Sheets
async function fetchSheetData(sheetName: string) {
  const url = `${BASE_URL}/${GOOGLE_SHEET_ID}/values/${sheetName}?key=${GOOGLE_SHEETS_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch sheet data');
    const data = await response.json();
    return data.values || [];
  } catch (error) {
    console.error(`Error fetching sheet: ${sheetName}`, error);
    return [];
  }
}

// Parse variants from Google Sheet
export async function fetchGoatVariants(): Promise<GoatVariant[]> {
  try {
    const rows = await fetchSheetData('Variants');
    
    // Skip header row and map data
    return rows.slice(1).map((row: any[], index: number) => ({
      id: `variant_${index}`,
      code: row[0] || '',
      name: row[1] || '',
      description: row[2] || '',
    }));
  } catch (error) {
    console.error('Error fetching variants:', error);
    return [];
  }
}

// Parse languages from Google Sheet
export async function fetchLanguages(): Promise<Language[]> {
  try {
    const rows = await fetchSheetData('Languages');
    
    // Skip header row and map data
    return rows.slice(1).map((row: any[], index: number) => ({
      id: `lang_${index}`,
      code: row[0] || '',
      name: row[1] || '',
      nativeName: row[2] || '',
    }));
  } catch (error) {
    console.error('Error fetching languages:', error);
    return [];
  }
}

// Cache data in localStorage
export function cacheVariants(variants: GoatVariant[]): void {
  localStorage.setItem('goat_variants', JSON.stringify({
    data: variants,
    timestamp: Date.now(),
  }));
}

export function getCachedVariants(): GoatVariant[] | null {
  const cached = localStorage.getItem('goat_variants');
  if (!cached) return null;

  const { data, timestamp } = JSON.parse(cached);
  
  // Cache valid for 24 hours
  if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
    return null;
  }
  
  return data;
}

export function cacheLanguages(languages: Language[]): void {
  localStorage.setItem('languages', JSON.stringify({
    data: languages,
    timestamp: Date.now(),
  }));
}

export function getCachedLanguages(): Language[] | null {
  const cached = localStorage.getItem('languages');
  if (!cached) return null;

  const { data, timestamp } = JSON.parse(cached);
  
  // Cache valid for 24 hours
  if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
    return null;
  }
  
  return data;
}

const DEFAULT_VARIANTS: GoatVariant[] = [
  { id: 'variant_0', code: 'VELLADU', name: 'வெள்ளாடு', description: 'வெள்ளாடு' },
  { id: 'variant_1', code: 'SEMMARI', name: 'செம்மறி', description: 'செம்மறி' },
];

// Get variants with caching
export async function getGoatVariants(): Promise<GoatVariant[]> {
  return DEFAULT_VARIANTS;
}

// Get languages with caching
export async function getLanguages(): Promise<Language[]> {
  const cached = getCachedLanguages();
  if (cached && cached.length > 0) return cached;

  const languages = await fetchLanguages();
  if (languages.length > 0) {
    cacheLanguages(languages);
  }
  return languages;
}
