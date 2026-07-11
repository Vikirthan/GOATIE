import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner, EmptyState } from '@/components/common/Loaders';
import { useAuth } from '@/context/AuthContext';
import {
  getFarmerGoats,
  createGoat,
  getGoatByEarTag,
  getAllDeworming,
  getAllVaccinations,
  recordVaccination,
  recordDeworming,
  recordWeight,
  recordSale,
  deleteGoat,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { supabase } from '@/lib/supabase';
import { getAllWeights } from '@/services/supabaseService';
import { Goat, DewormingRecord, PPRVaccinationRecord, WeightRecord } from '@/types';
import { Plus, Search, Download, Upload, Trash2, X, RefreshCw, Weight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { exportGoatsToExcel, importFullExcelData } from '@/utils/excelHelper';
import { generateQRCode, generateBarcode } from '@/utils/helpers';
import { showToast } from '@/components/common/Toast';

/** Parse a weight filter expression:
 *  "15+"  → { min: 15, max: Infinity }
 *  "15-"  → { min: 0, max: 15 }
 *  "10-20"→ { min: 10, max: 20 }
 *  "15"   → { min: 15, max: 15 }
 *  returns null when the expression is empty / invalid
 */
function parseWeightFilter(expr: string): { min: number; max: number } | null {
  const s = expr.trim();
  if (!s) return null;
  // "15+" pattern
  const plusMatch = s.match(/^(\d+(?:\.\d+)?)\+$/);
  if (plusMatch) return { min: parseFloat(plusMatch[1]), max: Infinity };
  // "15-" pattern (below)
  const minusMatch = s.match(/^(\d+(?:\.\d+)?)-$/);
  if (minusMatch) return { min: 0, max: parseFloat(minusMatch[1]) };
  // "10-20" range pattern
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    return lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
  }
  // exact number
  const exact = parseFloat(s);
  if (!isNaN(exact)) return { min: exact, max: exact };
  return null;
}

export const GoatsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [goats, setGoats] = useState<Goat[]>([]);
  const [filteredGoats, setFilteredGoats] = useState<Goat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'sold'>('all');
  const [weightFilter, setWeightFilter] = useState('');
  const [dewormingRecords, setDewormingRecords] = useState<DewormingRecord[]>([]);
  const [vaccineRecords, setVaccineRecords] = useState<PPRVaccinationRecord[]>([]);
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>([]);

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

  const loadGoatsList = async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      // 1. Instant local load
      if (!silent) {
        const localGoats = await indexedDB.getAllItems<Goat>('goats');
        const filteredLocal = localGoats
          .filter((g) => g.farmerId === user.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const localDeworm = await indexedDB.getAllItems<DewormingRecord>('deworming');
        const localVacc = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');
        setDewormingRecords(localDeworm);
        setVaccineRecords(localVacc);
        if (filteredLocal.length > 0) {
          setGoats(filteredLocal);
          setLoading(false);
        }
      }

      // 2. Fresh load from server
      const [freshGoats, freshDeworm, freshVacc, freshWeights] = await Promise.all([
        getFarmerGoats(user.id),
        getAllDeworming(),
        getAllVaccinations(),
        isSupabaseEnabled() ? getAllWeights() : Promise.resolve([] as WeightRecord[]),
      ]);

      setGoats(freshGoats);
      setDewormingRecords(freshDeworm);
      setVaccineRecords(freshVacc);
      setWeightRecords(freshWeights);
    } catch (error) {
      console.error('Error loading goats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadGoatsList();

    if (isSupabaseEnabled()) {
      const channel = supabase
        .channel('public:goats-list')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'goats' }, () => {
          loadGoatsList();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, () => {
          loadGoatsList();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deworming' }, () => {
          loadGoatsList();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vaccinations' }, () => {
          loadGoatsList();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  useEffect(() => {
    let result = goats;
    if (filter !== 'all') result = result.filter((g) => g.status === filter);
    if (searchTerm) {
      result = result.filter((g) =>
        g.earTagNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.variant.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    const wf = parseWeightFilter(weightFilter);
    if (wf) {
      result = result.filter((g) => {
        const currentWeight = latestWeightMap.get(g.id) ?? g.purchaseWeight;
        return currentWeight >= wf.min && currentWeight <= wf.max;
      });
    }
    setFilteredGoats(result);
  }, [goats, searchTerm, filter, weightFilter, latestWeightMap]);

  // ── Export: passes all loaded data so the 4-sheet workbook is complete ──
  const handleExportExcel = async () => {
    try {
      if (goats.length === 0) { showToast('warning', 'No goats to export'); return; }
      showToast('info', 'Preparing export…', 'Building all 4 sheets');
      // Collect sales from saleInfo embedded in goats
      const sales = goats.flatMap((g) => g.saleInfo ? [g.saleInfo] : []);
      await exportGoatsToExcel({
        goats,
        weights: weightRecords,
        dewormings: dewormingRecords,
        vaccinations: vaccineRecords,
        sales,
      });
      showToast('success', 'Excel exported!', '4 sheets: Goats, Weights, Deworming, Vaccination');
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
        if (pg.buyerName && pg.saleWeight && pg.saleWeight > 0 && pg.saleRatePerKg && pg.saleRatePerKg > 0) {
          const saleAmount = pg.saleWeight * pg.saleRatePerKg;
          const netProfit = saleAmount - pg.purchasePrice;
          const profitPercentage = pg.purchasePrice > 0 ? (netProfit / pg.purchasePrice) * 100 : 0;
          await recordSale(goatId, {
            goatId,
            saleDate: pg.saleDate || pg.purchaseDate || new Date(),
            saleWeight: pg.saleWeight,
            saleRatePerKg: pg.saleRatePerKg,
            buyerName: pg.buyerName,
            buyerContact: pg.buyerContact,
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

  if (loading) return <LoadingSpinner message="Loading goats..." />;

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
            onClick={() => loadGoatsList(true)}
            disabled={refreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/goats/register')}
            className="flex items-center gap-2"
            disabled={importing}
          >
            <Plus className="h-4 w-4" /> Register Goat
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
          <div className="flex gap-2 shrink-0">
            {(['all', 'active', 'sold'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Sold'}
              </Button>
            ))}
          </div>
        </div>

        {/* Weight filter row */}
        <div className="flex items-center gap-3">
          <div className="relative w-56">
            <Weight className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="weight-filter-input"
              placeholder="Weight: 15+  or  10-20  or  15-"
              value={weightFilter}
              onChange={(e) => setWeightFilter(e.target.value)}
              className={`pl-10 pr-10 text-sm ${
                weightFilter && !parseWeightFilter(weightFilter)
                  ? 'border-red-400 focus:ring-red-400'
                  : weightFilter && parseWeightFilter(weightFilter)
                  ? 'border-emerald-400'
                  : ''
              }`}
            />
            {weightFilter && (
              <button
                onClick={() => setWeightFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {weightFilter && parseWeightFilter(weightFilter) && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {(() => {
                const wf = parseWeightFilter(weightFilter)!;
                if (wf.max === Infinity) return `Showing goats ≥ ${wf.min} kg`;
                if (wf.min === 0 && weightFilter.trim().endsWith('-')) return `Showing goats ≤ ${wf.max} kg`;
                if (wf.min === wf.max) return `Showing goats = ${wf.min} kg`;
                return `Showing goats ${wf.min}–${wf.max} kg`;
              })()}
            </span>
          )}
          {weightFilter && !parseWeightFilter(weightFilter) && (
            <span className="text-xs text-red-500 font-medium">Invalid format. Try: 15+  or  10-20  or  15-</span>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Filter by current weight
          </span>
        </div>
      </div>

      {/* Goats List */}
      {filteredGoats.length === 0 ? (
        <EmptyState
          title="No goats found"
          description={searchTerm ? 'Try adjusting your search terms' : 'Register your first goat to get started'}
          action={
            <Button variant="primary" onClick={() => navigate('/goats/register')}>
              Register First Goat
            </Button>
          }
        />
      ) : (
        <>
          {/* ── Desktop Table ── */}
          <div className="hidden md:block rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm border-b border-border">
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
                  {filteredGoats.map((goat, idx) => {
                    const vaccineStatus = getGoatVaccineStatus(goat.id);
                    const dewormStatus = getGoatDewormingStatus(goat.id);
                    return (
                      <tr
                        key={goat.id}
                        onClick={() => navigate(`/goats/${goat.id}`)}
                        className={`cursor-pointer transition-colors duration-150 hover:bg-accent/50 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'}`}
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {goat.status === 'sold' ? (
                            <span className="font-semibold text-amber-600 dark:text-amber-400">Sold</span>
                          ) : (
                            <span className="font-semibold text-foreground">{goat.earTagNumber}</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-foreground whitespace-nowrap">{goat.variant}</td>
                        <td className="px-4 py-3.5 text-foreground whitespace-nowrap capitalize">{goat.gender}</td>
                        <td className="px-4 py-3.5 text-foreground text-right whitespace-nowrap tabular-nums">
                          {latestWeightMap.get(goat.id) ?? goat.purchaseWeight}{' '}
                          <span className="text-muted-foreground text-xs">kg</span>
                          {latestWeightMap.has(goat.id) && latestWeightMap.get(goat.id) !== goat.purchaseWeight && (
                            <span className="text-muted-foreground text-xs block leading-none">
                              (was {goat.purchaseWeight})
                            </span>
                          )}
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
                        </td>
                        <td className="px-4 py-3.5 text-center">
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
            <div className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
              Showing {filteredGoats.length} of {goats.length} goats
            </div>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="md:hidden space-y-3">
            {filteredGoats.map((goat) => {
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
                        <h3 className={`text-base font-bold truncate ${goat.status === 'sold' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                          {goat.status === 'sold' ? 'Sold' : goat.earTagNumber}
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
                      </div>
                      <button
                        onClick={(e) => handleDeleteGoat(e, goat.id)}
                        className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-red-500 bg-red-50 hover:bg-red-500 hover:text-white dark:bg-red-950/30 dark:hover:bg-red-600 transition-all duration-150"
                        title="Delete goat"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
                        {latestWeightMap.has(goat.id) && latestWeightMap.get(goat.id) !== goat.purchaseWeight && (
                          <span className="text-muted-foreground text-xs"> (was {goat.purchaseWeight} kg)</span>
                        )}
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
            <p className="text-center text-xs text-muted-foreground pt-1 pb-2">
              Showing {filteredGoats.length} of {goats.length} goats
            </p>
          </div>
        </>
      )}
    </div>
  );
};
