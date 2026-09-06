import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGoatsData } from '@/hooks/useGoatsData';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/common/Loaders';
import { useAuth } from '@/context/AuthContext';
import {
  createGoat,
  getGoatByEarTag,
  recordVaccination,
  recordDeworming,
  recordWeight,
  recordSale,
  deleteGoat,
  updateGoat,
  forceSync,
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { Goat, DewormingRecord, PPRVaccinationRecord, WeightRecord } from '@/types';
import { Search, Download, Upload, Trash2, Edit2, X, RefreshCw, Weight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Label } from '@/components/ui/Label';
import { exportGoatsToExcel, importFullExcelData } from '@/utils/excelHelper';
import { generateQRCode, generateBarcode } from '@/utils/helpers';
import { showToast } from '@/components/common/Toast';
import { format } from 'date-fns';

const formatEntryDate = (date: Date | string | undefined): string => {
  if (!date) return '';
  try {
    return format(new Date(date), 'dd/MM/yy');
  } catch {
    return '';
  }
};

/** Picks which date to show per the active status filter:
 *  "sold" -> sale date, "deceased" -> death date (falls back to updatedAt if not set),
 *  "active"/"all" -> purchase date. */
const getDisplayDate = (
  goat: Goat,
  currentFilter: 'all' | 'active' | 'sold' | 'deceased'
): Date | string | undefined => {
  if (currentFilter === 'sold') return goat.saleInfo?.saleDate ?? goat.purchaseDate;
  if (currentFilter === 'deceased') return goat.deathDate ?? goat.updatedAt ?? goat.purchaseDate;
  return goat.purchaseDate;
};

/** Builds a { min, max } range from separate min/max text-inputs.
 *  Either side may be left blank to mean "no lower/upper bound".
 *  Returns null when both sides are blank (no filter applied) or unparsable. */
function rangeFromMinMax(
  minStr: string,
  maxStr: string,
  unboundedMin: number = 0
): { min: number; max: number } | null {
  const minTrim = minStr.trim();
  const maxTrim = maxStr.trim();
  if (!minTrim && !maxTrim) return null;
  const min = minTrim ? parseFloat(minTrim) : unboundedMin;
  const max = maxTrim ? parseFloat(maxTrim) : Infinity;
  if (isNaN(min) || isNaN(max)) return null;
  return min <= max ? { min, max } : { min: max, max: min };
}

const PAGE_SIZE = 25;

const PaginationControls: React.FC<{ page: number; totalPages: number; onPageChange: (page: number) => void }> = ({
  page, totalPages, onPageChange,
}) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Prev
      </button>
      <span className="text-xs text-muted-foreground tabular-nums">Page {page + 1} of {totalPages}</span>
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
};

export const GoatsListPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { data: queryData, isLoading: queryLoading, refetch } = useGoatsData(user?.id);
  const loadGoatsList = (silent = false) => {
    if (!silent) setLoading(true);
    refetch();
  };
  const [goats, setGoats] = useState<Goat[]>([]);
  const [filteredGoats, setFilteredGoats] = useState<Goat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => sessionStorage.getItem('goats_searchTerm') || '');
  const [filter, setFilter] = useState<'all' | 'active' | 'sold' | 'deceased'>(() => (sessionStorage.getItem('goats_filter') as any) || 'all');
  const [variantFilter, setVariantFilter] = useState<string>(() => sessionStorage.getItem('goats_variantFilter') || 'all');
  const [weightMin, setWeightMin] = useState(() => sessionStorage.getItem('goats_weightMin') || '');
  const [weightMax, setWeightMax] = useState(() => sessionStorage.getItem('goats_weightMax') || '');
  const [weightGainMin, setWeightGainMin] = useState(() => sessionStorage.getItem('goats_weightGainMin') || '');
  const [weightGainMax, setWeightGainMax] = useState(() => sessionStorage.getItem('goats_weightGainMax') || '');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (location.state?.usr?.status) {
      setFilter(location.state.usr.status);
      setSearchTerm('');
      setVariantFilter('all');
      setWeightMin('');
      setWeightMax('');
      setWeightGainMin('');
      setWeightGainMax('');
      // Clear location state to prevent locking the filter on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    sessionStorage.setItem('goats_searchTerm', searchTerm);
    sessionStorage.setItem('goats_filter', filter);
    sessionStorage.setItem('goats_variantFilter', variantFilter);
    sessionStorage.setItem('goats_weightMin', weightMin);
    sessionStorage.setItem('goats_weightMax', weightMax);
    sessionStorage.setItem('goats_weightGainMin', weightGainMin);
    sessionStorage.setItem('goats_weightGainMax', weightGainMax);
  }, [searchTerm, filter, variantFilter, weightMin, weightMax, weightGainMin, weightGainMax]);
  const [dewormingRecords, setDewormingRecords] = useState<DewormingRecord[]>([]);
  const [vaccineRecords, setVaccineRecords] = useState<PPRVaccinationRecord[]>([]);
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>([]);

  const [syncing, setSyncing] = useState(false);
  const [editingGoat, setEditingGoat] = useState<Goat | null>(null);
  const [editForm, setEditForm] = useState({ earTagNumber: '', purchaseWeight: '', purchasePrice: '', purchaseDate: '', status: 'active' as Goat['status'], deathDate: '' });

  // Map goatId → latest recorded weight value
  const latestWeightMap = React.useMemo(() => {
    const map = new Map<string, number>();
    // group by goatId, pick the highest weightNumber that isRecorded and weight > 0
    const byGoat = new Map<string, WeightRecord[]>();
    for (const wr of weightRecords) {
      if (!byGoat.has(wr.goatId)) byGoat.set(wr.goatId, []);
      byGoat.get(wr.goatId)!.push(wr);
    }
    byGoat.forEach((records, goatId) => {
      const recorded = records
        .filter((r) => r.isRecorded && r.weight > 0)
        .sort((a, b) => b.weightNumber - a.weightNumber);
      if (recorded.length > 0) map.set(goatId, recorded[0].weight);
    });
    return map;
  }, [weightRecords]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDeleteGoat = async (e: React.MouseEvent, goatId: string) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this goat entry? This cannot be undone.')) return;
    try {
      await deleteGoat(goatId);
      showToast('success', 'Goat deleted successfully');
      loadGoatsList();
    } catch (err: any) {
      showToast('error', 'Failed to delete goat', err.message);
    }
  };

  const handleEditClick = (e: React.MouseEvent, goat: Goat) => {
    e.stopPropagation();
    setEditingGoat(goat);
    setEditForm({
      earTagNumber: goat.earTagNumber || '',
      status: goat.status || 'active',
      purchaseWeight: goat.purchaseWeight.toString(),
      purchasePrice: goat.purchasePrice.toString(),
      purchaseDate: new Date(goat.purchaseDate).toISOString().split('T')[0],
      deathDate: goat.deathDate ? new Date(goat.deathDate).toISOString().split('T')[0] : '',
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGoat) return;
    try {
      const weight = parseFloat(editForm.purchaseWeight);
      const price = parseFloat(editForm.purchasePrice);
      const purchasePricePerKg = weight > 0 ? Number((price / weight).toFixed(2)) : 0;

      const updates: Partial<Goat> = {
        earTagNumber: editForm.earTagNumber,
        status: editForm.status as Goat['status'],
        purchaseWeight: weight,
        purchasePrice: price,
        purchasePricePerKg: purchasePricePerKg,
        purchaseDate: new Date(editForm.purchaseDate),
        deathDate: editForm.status === 'deceased' && editForm.deathDate ? new Date(editForm.deathDate) : undefined,
      };

      await updateGoat(editingGoat.id, updates);
      showToast('success', 'Goat updated successfully');
      setEditingGoat(null);
      loadGoatsList();
    } catch (err: any) {
      showToast('error', 'Failed to update goat', err.message);
    }
  };

  // IndexedDB only mirrors records created locally through this browser (see
  // recordDeworming/recordVaccination/recordWeight) — it is not a full offline
  // copy of the network data. Once the network/persisted-cache data has been
  // applied, the local load below must never overwrite it with that partial
  // snapshot, no matter which async read finishes last.
  const networkDataAppliedRef = useRef(false);

  // 1. Initial Local Data Load (Offline First)
  useEffect(() => {
    if (!user) return;
    const loadLocalData = async () => {
      try {
        const localGoats = await indexedDB.getAllItems<Goat>('goats');
        const filteredLocal = localGoats
          .filter((g) => g.farmerId === user.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const localDeworm = await indexedDB.getAllItems<DewormingRecord>('deworming');
        const localVacc = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
        const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');

        if (networkDataAppliedRef.current) return;
        if (filteredLocal.length > 0) {
          setGoats(filteredLocal);
          setDewormingRecords(localDeworm);
          setVaccineRecords(localVacc);
          setWeightRecords(localWeights);
        }
      } catch (error) {
        console.error('Error loading local goats data:', error);
      }
    };
    loadLocalData();
  }, [user]);

  // 2. Network Data Sync (React Query)
  useEffect(() => {
    if (queryLoading || !queryData || !user) return;

    try {
      const { freshGoats, freshDeworm, freshVacc, freshWeights } = queryData;
      networkDataAppliedRef.current = true;
      setGoats(freshGoats);
      setDewormingRecords(freshDeworm);
      setVaccineRecords(freshVacc);
      setWeightRecords(freshWeights);
    } catch (error) {
      console.error('Error processing network goats data:', error);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [queryData, queryLoading, user]);

  const handleSyncData = async () => {
    if (!user) return;
    try {
      setSyncing(true);
      await forceSync(user.id);
      showToast('success', 'Offline data synced successfully');
      await loadGoatsList(true);
    } catch (error) {
      showToast('error', 'Failed to sync data');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const sortDate = (g: Goat) => new Date(getDisplayDate(g, filter) ?? g.purchaseDate).getTime();
    let result = [...goats].sort((a, b) => sortDate(b) - sortDate(a));
    if (filter !== 'all') result = result.filter((g) => g.status === filter);
    if (variantFilter !== 'all') result = result.filter((g) => String(g.variant || '').toUpperCase() === variantFilter);
    if (searchTerm) {
      result = result.filter((g) =>
        String(g.earTagNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(g.variant || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    const wf = rangeFromMinMax(weightMin, weightMax, 0);
    if (wf) {
      result = result.filter((g) => g.status !== 'sold');
      result = result.filter((g) => {
        const currentWeight = latestWeightMap.get(g.id) ?? g.purchaseWeight;
        return currentWeight >= wf.min && currentWeight <= wf.max;
      });
      // Sort ascending by weight (small to big)
      result.sort((a, b) => {
        const weightA = latestWeightMap.get(a.id) ?? a.purchaseWeight;
        const weightB = latestWeightMap.get(b.id) ?? b.purchaseWeight;
        return weightA - weightB;
      });
    }
    const wgf = rangeFromMinMax(weightGainMin, weightGainMax, -Infinity);
    if (wgf) {
      result = result.filter((g) => g.status !== 'sold');
      result = result.filter((g) => {
        const gWeights = weightRecords
          .filter(w => w.goatId === g.id && w.isRecorded && w.weight > 0)
          .sort((a, b) => b.weightNumber - a.weightNumber);
        
        // If no weights recorded after purchase, do not include in filter
        // Note: A new goat always has a record for weightNumber 0 (purchase weight).
        const hasSubsequentWeight = gWeights.some(w => w.weightNumber > 0);
        if (!hasSubsequentWeight) return false;
        
        const latest = gWeights[0].weight;
        const previous = gWeights.length > 1 ? gWeights[1].weight : g.purchaseWeight;
        
        const gain = latest - previous;
        return gain >= wgf.min && gain <= wgf.max;
      });
      // Sort ascending by weight gain
      result.sort((a, b) => {
        const getGain = (g: Goat) => {
          const gWeights = weightRecords
            .filter(w => w.goatId === g.id && w.isRecorded && w.weight > 0)
            .sort((x, y) => y.weightNumber - x.weightNumber);
          const latest = gWeights[0]?.weight || 0;
          const previous = gWeights.length > 1 ? gWeights[1].weight : g.purchaseWeight;
          return latest - previous;
        };
        return getGain(a) - getGain(b);
      });
    }
    setFilteredGoats(result);
    setPage(0);
  }, [goats, searchTerm, filter, variantFilter, weightMin, weightMax, weightGainMin, weightGainMax, latestWeightMap, weightRecords]);

  const totalPages = Math.max(1, Math.ceil(filteredGoats.length / PAGE_SIZE));
  const paginatedGoats = filteredGoats.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Export: passes only the currently filtered goats so the workbook matches what's on screen ──
  const handleExportExcel = async () => {
    try {
      if (filteredGoats.length === 0) { showToast('warning', 'No goats to export for the current filter'); return; }
      showToast('info', 'Preparing export…', 'Building all 4 sheets');
      const filteredIds = new Set(filteredGoats.map((g) => g.id));
      // Collect sales from saleInfo embedded in the filtered goats
      const sales = filteredGoats.flatMap((g) => g.saleInfo ? [g.saleInfo] : []);
      await exportGoatsToExcel({
        goats: filteredGoats,
        weights: weightRecords.filter((w) => filteredIds.has(w.goatId)),
        dewormings: dewormingRecords.filter((d) => filteredIds.has(d.goatId)),
        vaccinations: vaccineRecords.filter((v) => filteredIds.has(v.goatId)),
        sales,
      });
      showToast('success', 'Excel exported!', `${filteredGoats.length} goat(s) matching current filter · 4 sheets`);
    } catch (error: any) {
      showToast('error', 'Export failed', error.message);
    }
  };

  // ── Full Import: reads all 4 sheets and upserts into Supabase ──
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setImporting(true);
    try {
      const { goats: parsedGoats, weights: parsedWeights, dewormings: parsedDeworm, vaccinations: parsedVacc } =
        await importFullExcelData(file);

      if (parsedGoats.length === 0) {
        showToast('warning', 'No goat records found in Goats Data sheet');
        setImporting(false);
        return;
      }

      let goatsImported = 0, goatsSkipped = 0;
      let weightsImported = 0, dewormImported = 0, vaccImported = 0;

      // Map earTag → goatId (new + existing)
      const earTagToId = new Map<string, string>();

      for (const pg of parsedGoats) {
        const existing = await getGoatByEarTag(user.id, pg.earTagNumber);
        if (existing) {
          earTagToId.set(pg.earTagNumber, existing.id);
          goatsSkipped++;
          continue;
        }

        const qrCode = await generateQRCode(pg.earTagNumber);
        const barcode = generateBarcode(pg.earTagNumber);

        const goatId = await createGoat(user.id, {
          earTagNumber: pg.earTagNumber,
          purchaseDate: pg.purchaseDate,
          purchaseWeight: pg.purchaseWeight,
          variant: pg.variant,
          gender: pg.gender,
          purchasePrice: pg.purchasePrice,
          sellerName: pg.sellerName || 'N/A',
          notes: pg.notes,
          photoURL: pg.photoURL,
          qrCode,
          barcode,
        });
        earTagToId.set(pg.earTagNumber, goatId);

        // Basic vaccination/deworming from Goats sheet (if no dedicated sheet rows)
        if (pg.vaccinationStatus === 'vaccinated') {
          await recordVaccination(goatId, { goatId, vaccinationDate: pg.purchaseDate || new Date(), status: 'vaccinated' });
        }
        if (pg.dewormingStatus === 'dewormed') {
          await recordDeworming(goatId, { goatId, dewormingDate: pg.purchaseDate || new Date(), status: 'dewormed' });
        }
        if (pg.saleWeight && pg.saleWeight > 0 && pg.saleRatePerKg && pg.saleRatePerKg > 0) {
          const saleAmount = pg.saleWeight * pg.saleRatePerKg;
          const netProfit = saleAmount - pg.purchasePrice;
          const profitPercentage = pg.purchasePrice > 0 ? (netProfit / pg.purchasePrice) * 100 : 0;
          await recordSale(goatId, {
            goatId,
            saleDate: pg.saleDate || pg.purchaseDate || new Date(),
            saleWeight: pg.saleWeight,
            saleRatePerKg: pg.saleRatePerKg,
            buyerName: 'N/A',
            saleAmount,
            netProfit,
            profitPercentage,
            remarks: pg.remarks,
          });
        }
        goatsImported++;
      }

      // ── Insert weight records from Monthly Weights sheet (skip W0, already set) ──
      for (const pw of parsedWeights) {
        const goatId = earTagToId.get(pw.earTagNumber);
        if (!goatId || pw.weightNumber === 0) continue; // W0 = purchase weight, already recorded
        try {
          await recordWeight(goatId, {
            goatId,
            weightNumber: pw.weightNumber as 0 | 1 | 2 | 3 | 4,
            weight: pw.weight,
            dueDate: pw.dueDate || new Date(),
            recordedDate: pw.recordedDate,
            remarks: pw.remarks,
            isRecorded: true,
          });
          weightsImported++;
        } catch { /* skip duplicates */ }
      }

      // ── Insert deworming records from Deworming sheet ──
      for (const pd of parsedDeworm) {
        const goatId = earTagToId.get(pd.earTagNumber);
        if (!goatId) continue;
        try {
          await recordDeworming(goatId, {
            goatId,
            dewormingDate: pd.dewormingDate,
            roundNumber: pd.roundNumber,
            medicineUsed: pd.medicineUsed,
            administeredBy: pd.administeredBy,
            batchNumber: pd.batchNumber,
            remarks: pd.remarks,
            status: 'dewormed',
          });
          dewormImported++;
        } catch { /* skip duplicates */ }
      }

      // ── Insert vaccination records from Vaccination sheet ──
      for (const pv of parsedVacc) {
        const goatId = earTagToId.get(pv.earTagNumber);
        if (!goatId) continue;
        try {
          await recordVaccination(goatId, {
            goatId,
            vaccinationDate: pv.vaccinationDate,
            roundNumber: pv.roundNumber,
            vaccineBrand: pv.vaccineBrand,
            administeredBy: pv.administeredBy,
            batchNumber: pv.batchNumber,
            remarks: pv.remarks,
            status: 'vaccinated',
          });
          vaccImported++;
        } catch { /* skip duplicates */ }
      }

      showToast(
        'success',
        'Import completed!',
        `Goats: ${goatsImported} new (${goatsSkipped} skipped) · Weights: ${weightsImported} · Deworming: ${dewormImported} · Vaccination: ${vaccImported}`
      );
      await loadGoatsList();
    } catch (error: any) {
      showToast('error', 'Import failed', error.message);
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const getGoatVaccineStatus = (goatId: string): string => {
    const record = vaccineRecords.find((r) => r.goatId === goatId);
    return record ? 'Vaccinated' : 'Unvaccinated';
  };

  const getGoatDewormingStatus = (goatId: string): string => {
    const record = dewormingRecords.find((r) => r.goatId === goatId);
    return record ? 'Dewormed' : 'Not done';
  };

  // No loading check to prevent full page spinner

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Goats</h1>
          <p className="text-muted-foreground mt-1">Manage your goat inventory · {goats.length} total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncData}
            disabled={syncing || refreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sync Offline
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="flex items-center gap-2"
            disabled={loading || importing}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handleImportExcel}
            className="hidden"
            ref={fileInputRef}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2"
            isLoading={importing}
            disabled={loading || importing}
          >
            <Upload className="h-4 w-4" /> Import
          </Button>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by ear tag or variant..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-row gap-2 shrink-0">
            <Select
              id="status-filter-select"
              className="w-32 sm:w-40 shrink-0"
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'sold', label: 'Sold' },
                { value: 'deceased', label: 'Dead' },
              ]}
              value={filter}
              onChange={(v) => setFilter(v as 'all' | 'active' | 'sold' | 'deceased')}
            />
            <Select
              id="variant-filter-select"
              className="w-36 sm:w-44 shrink-0"
              options={[
                { value: 'all', label: 'All Variants' },
                { value: 'SEMMARI', label: 'SEMMARI' },
                { value: 'VELLADU', label: 'VELLADU' },
              ]}
              value={variantFilter}
              onChange={setVariantFilter}
            />
          </div>
        </div>

        {/* Weight filter row */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          {/* Current Weight Filter */}
          <div className="flex items-center gap-2">
            <Weight className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              id="weight-min-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              placeholder="Min kg"
              value={weightMin}
              onChange={(e) => setWeightMin(e.target.value)}
              className="w-24 text-sm"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              id="weight-max-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              placeholder="Max kg"
              value={weightMax}
              onChange={(e) => setWeightMax(e.target.value)}
              className="w-24 text-sm"
            />
            <span className="text-xs text-muted-foreground">Weight</span>
            {(weightMin || weightMax) && (
              <button
                onClick={() => { setWeightMin(''); setWeightMax(''); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear weight filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Weight Gain Filter */}
          <div className="flex items-center gap-2">
            <Weight className="h-4 w-4 text-emerald-500 shrink-0" />
            <Input
              id="weight-gain-min-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              placeholder="Min gain"
              value={weightGainMin}
              onChange={(e) => setWeightGainMin(e.target.value)}
              className="w-24 text-sm"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              id="weight-gain-max-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              placeholder="Max gain"
              value={weightGainMax}
              onChange={(e) => setWeightGainMax(e.target.value)}
              className="w-24 text-sm"
            />
            <span className="text-xs text-muted-foreground">Gain</span>
            {(weightGainMin || weightGainMax) && (
              <button
                onClick={() => { setWeightGainMin(''); setWeightGainMax(''); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear weight gain filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{filteredGoats.length}</span> of{' '}
        <span className="font-semibold text-foreground">{goats.length}</span> goats
      </p>

      {/* Goats List */}
      {filteredGoats.length === 0 ? (
        <EmptyState
          title="No goats found"
          description={searchTerm ? 'Try adjusting your search terms' : 'Register your first goat to get started from Quick Actions'}
        />
      ) : (
        <>
          {/* ── Desktop Table ── */}
          <div className="hidden md:block rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm border-b border-border">
                    <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap w-12">S.No</th>
                    <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Ear Tag / Status</th>
                    <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Variant</th>
                    <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Gender</th>
                    <th className="text-right font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Weight</th>
                    <th className="text-right font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Price</th>
                    <th className="text-center font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Vaccine</th>
                    <th className="text-center font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Deworm</th>
                    <th className="text-center font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Status</th>
                    <th className="text-center font-semibold text-muted-foreground px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedGoats.map((goat, idx) => {
                    const vaccineStatus = getGoatVaccineStatus(goat.id);
                    const dewormStatus = getGoatDewormingStatus(goat.id);
                    return (
                      <tr
                        key={goat.id}
                        onClick={() => navigate(`/goats/${goat.id}`)}
                        className={`cursor-pointer transition-colors duration-150 hover:bg-accent/50 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'}`}
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">{page * PAGE_SIZE + idx + 1}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={`font-semibold ${goat.status === 'sold' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                            {goat.earTagNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-foreground whitespace-nowrap">{goat.variant}</td>
                        <td className="px-4 py-3.5 text-foreground whitespace-nowrap capitalize">{goat.gender}</td>
                        <td className="px-4 py-3.5 text-foreground text-right whitespace-nowrap tabular-nums">
                          {latestWeightMap.get(goat.id) ?? goat.purchaseWeight}{' '}
                          <span className="text-muted-foreground text-xs">kg</span>
                          {(() => {
                            if (!latestWeightMap.has(goat.id)) return null;
                            const current = latestWeightMap.get(goat.id)!;
                            if (current === goat.purchaseWeight) return null;
                            const gain = current - goat.purchaseWeight;
                            const isPositive = gain > 0;
                            return (
                              <span className={`text-xs block leading-none mt-1 font-medium ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                {isPositive ? '+' : ''}{Number(gain.toFixed(2))} kg
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3.5 text-foreground text-right whitespace-nowrap tabular-nums font-medium">
                          ₹{goat.purchasePrice.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center gap-1.5" title={vaccineStatus}>
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${vaccineStatus === 'Vaccinated' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <span className="text-xs text-muted-foreground hidden lg:inline">{vaccineStatus === 'Vaccinated' ? 'Done' : 'No'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center gap-1.5" title={dewormStatus}>
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dewormStatus === 'Dewormed' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <span className="text-xs text-muted-foreground hidden lg:inline">{dewormStatus === 'Dewormed' ? 'Done' : 'No'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full leading-none ${
                            goat.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : goat.status === 'sold'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {goat.status.charAt(0).toUpperCase() + goat.status.slice(1)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground mt-1">
                            {formatEntryDate(getDisplayDate(goat, filter))}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <button
                            onClick={(e) => handleEditClick(e, goat)}
                            className="inline-flex items-center justify-center h-8 w-8 mr-2 rounded-lg text-blue-500 hover:text-white hover:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            title="Edit goat"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteGoat(e, goat.id)}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-red-500 hover:text-white hover:bg-red-500 dark:hover:bg-red-600 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-red-400"
                            title="Delete goat"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {paginatedGoats.length} of {filteredGoats.length} goats</span>
              <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="md:hidden space-y-3">
            {paginatedGoats.map((goat, idx) => {
              const vaccineStatus = getGoatVaccineStatus(goat.id);
              const dewormStatus = getGoatDewormingStatus(goat.id);
              return (
                <div
                  key={goat.id}
                  onClick={() => navigate(`/goats/${goat.id}`)}
                  className="group relative rounded-xl border border-border bg-card shadow-sm hover:shadow-md active:scale-[0.995] transition-all duration-150 cursor-pointer overflow-hidden"
                >
                  <div className={`absolute top-0 left-0 right-0 h-0.5 ${
                    goat.status === 'active' ? 'bg-emerald-500' : goat.status === 'sold' ? 'bg-amber-500' : 'bg-gray-400'
                  }`} />
                  <div className="p-4 pt-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{page * PAGE_SIZE + idx + 1}.</span>
                        <h3 className={`text-base font-bold truncate ${goat.status === 'sold' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                          {goat.earTagNumber}
                        </h3>
                        <span className={`shrink-0 inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full leading-none ${
                          goat.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : goat.status === 'sold'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {goat.status}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatEntryDate(getDisplayDate(goat, filter))}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => handleEditClick(e, goat)}
                          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-blue-500 bg-blue-50 hover:bg-blue-500 hover:text-white dark:bg-blue-950/30 dark:hover:bg-blue-600 transition-all duration-150"
                          title="Edit goat"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteGoat(e, goat.id)}
                          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-red-500 bg-red-50 hover:bg-red-500 hover:text-white dark:bg-red-950/30 dark:hover:bg-red-600 transition-all duration-150"
                          title="Delete goat"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {goat.variant} <span className="mx-1 opacity-40">•</span> <span className="capitalize">{goat.gender}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Current Weight</span>
                        <span className="font-medium text-foreground tabular-nums">
                          {latestWeightMap.get(goat.id) ?? goat.purchaseWeight} kg
                        </span>
                        {(() => {
                          if (!latestWeightMap.has(goat.id)) return null;
                          const current = latestWeightMap.get(goat.id)!;
                          if (current === goat.purchaseWeight) return null;
                          const gain = current - goat.purchaseWeight;
                          const isPositive = gain > 0;
                          return (
                            <span className={`text-xs ml-1 font-medium ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                              ({isPositive ? '+' : ''}{Number(gain.toFixed(2))} kg)
                            </span>
                          );
                        })()}
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">Price</span>
                        <span className="font-medium text-foreground tabular-nums">₹{goat.purchasePrice.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pt-3 border-t border-dashed border-border text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${vaccineStatus === 'Vaccinated' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className={`font-medium ${vaccineStatus === 'Vaccinated' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                          {vaccineStatus}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${dewormStatus === 'Dewormed' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className={`font-medium ${dewormStatus === 'Dewormed' ? 'text-blue-600 dark:text-blue-400' : 'text-orange-500'}`}>
                          {dewormStatus}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-col items-center gap-2 pt-1 pb-2">
              <p className="text-center text-xs text-muted-foreground">
                Showing {paginatedGoats.length} of {filteredGoats.length} goats
              </p>
              <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </div>
        </>
      )}
      {/* Edit Modal */}
      {editingGoat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card w-full max-w-md rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-bold">Edit Goat #{editingGoat.earTagNumber}</h3>
              <button onClick={() => setEditingGoat(null)} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-4">
              <div>
                <Label htmlFor="editEarTag">Ear Tag Number</Label>
                <Input
                  id="editEarTag"
                  type="text"
                  value={editForm.earTagNumber}
                  onChange={(e) => setEditForm({ ...editForm, earTagNumber: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="editStatus">Status</Label>
                <select
                  id="editStatus"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Goat['status'] })}
                  className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                >
                  <option value="active" className="bg-background text-foreground">Active</option>
                  <option value="sold" className="bg-background text-foreground">Sold</option>
                  <option value="deceased" className="bg-background text-foreground">Dead (Deceased)</option>
                </select>
              </div>
              {editForm.status === 'deceased' && (
                <div>
                  <Label htmlFor="editDeathDate">Death Date</Label>
                  <Input
                    id="editDeathDate"
                    type="date"
                    value={editForm.deathDate}
                    onChange={(e) => setEditForm({ ...editForm, deathDate: e.target.value })}
                    required
                  />
                </div>
              )}
              <div>
                <Label htmlFor="editWeight">Purchase Weight (kg)</Label>
                <Input
                  id="editWeight"
                  type="number"
                  step="0.1"
                  value={editForm.purchaseWeight}
                  onChange={(e) => setEditForm({ ...editForm, purchaseWeight: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="editPrice">Purchase Price (₹)</Label>
                <Input
                  id="editPrice"
                  type="number"
                  step="0.01"
                  value={editForm.purchasePrice}
                  onChange={(e) => setEditForm({ ...editForm, purchasePrice: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="editDate">Purchase Date</Label>
                <Input
                  id="editDate"
                  type="date"
                  value={editForm.purchaseDate}
                  onChange={(e) => setEditForm({ ...editForm, purchaseDate: e.target.value })}
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingGoat(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
