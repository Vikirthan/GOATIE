import { GoatVariant } from '@/types';

// Static breed list — the registration form always has options, even offline
// or when Google Sheets is unreachable. (The live Sheets fetch + cache
// machinery was removed: nothing called it, and the variants sheet is no
// longer a dependency.)
const DEFAULT_VARIANTS: GoatVariant[] = [
  { id: 'variant_0', code: 'VELLADU', name: 'வெள்ளாடு', description: 'வெள்ளாடு' },
  { id: 'variant_1', code: 'SEMMARI', name: 'செம்மறி', description: 'செம்மறி' },
  { id: 'variant_2', code: 'LOCAL', name: 'Local', description: 'Local / non-descript' },
];

export async function getGoatVariants(): Promise<GoatVariant[]> {
  return DEFAULT_VARIANTS;
}
