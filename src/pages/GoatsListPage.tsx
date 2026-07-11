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
  recordSale,
  deleteGoat,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { supabase } from '@/lib/supabase';
import { Goat, DewormingRecord, PPRVaccinationRecord } from '@/types';
import { Plus, Search, Download, Upload, Trash2, X, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { exportGoatsToExcel, importGoatsFromExcel } from '@/utils/excelHelper';
import { generateQRCode, generateBarcode } from '@/utils/helpers';
import { showToast } from '@/components/common/Toast';

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
  const [dewormingRecords, setDewormingRecords] = useState<DewormingRecord[]>([]);
  const [vaccineRecords, setVaccineRecords] = useState<PPRVaccinationRecord[]>([]);

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

      // 2. Fresh load from Sheets
      const [freshGoats, freshDeworm, freshVacc] = await Promise.all([
        getFarmerGoats(user.id),
        getAllDeworming(),
        getAllVaccinations(),
      ]);

      setGoats(freshGoats);
      setDewormingRecords(freshDeworm);
      setVaccineRecords(freshVacc);
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
    setFilteredGoats(result);
  }, [goats, searchTerm, filter]);

  const handleExportExcel = async () => {
    try {
      if (goats.length === 0) { showToast('warning', 'No goats to export'); return; }
      await exportGoatsToExcel(goats);
      showToast('success', 'Excel exported successfully');
    } catch (error: any) {
      showToast('error', 'Failed to export Excel', error.message);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setImporting(true);
    try {
      const parsedGoats = await importGoatsFromExcel(file);
      if (parsedGoats.length === 0) {
        showToast('warning', 'No valid goat records found in the Excel file');
        setImporting(false);
        return;
      }

      let importedCount = 0;
      let skippedCount = 0;

      for (const pg of parsedGoats) {
        const existing = await getGoatByEarTag(user.id, pg.earTagNumber);
        if (existing) { skippedCount++; continue; }

        const qrCode = await generateQRCode(pg.earTagNumber);
        const barcode = generateBarcode(pg.earTagNumber);

        const goatId = await createGoat(user.id, {
          earTagNumber: pg.earTagNumber,
          purchaseDate: pg.purchaseDate,
          purchaseWeight: pg.purchaseWeight,
          variant: pg.variant,
          gender: pg.gender,
          purchasePrice: pg.purchasePrice,
          sellerName: pg.sellerName,
          notes: pg.notes,
          photoURL: pg.photoURL,
          qrCode,
          barcode
        });

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
            goatId, saleDate: pg.saleDate || pg.purchaseDate || new Date(),
            saleWeight: pg.saleWeight, saleRatePerKg: pg.saleRatePerKg,
            buyerName: pg.buyerName, buyerContact: pg.buyerContact,
            saleAmount, netProfit, profitPercentage, remarks: pg.remarks,
          });
        }
        importedCount++;
      }

      showToast('success', 'Import completed!', `Imported: ${importedCount}, Skipped: ${skippedCount}`);
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
                          {goat.purchaseWeight} <span className="text-muted-foreground text-xs">kg</span>
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
                        <span className="text-muted-foreground text-xs block mb-0.5">Weight</span>
                        <span className="font-medium text-foreground tabular-nums">{goat.purchaseWeight} kg</span>
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
