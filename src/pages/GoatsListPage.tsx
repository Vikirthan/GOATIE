import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
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
  recordSale
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { Goat, DewormingRecord, PPRVaccinationRecord } from '@/types';
import { Plus, Search, Download, Upload } from 'lucide-react';
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
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'sold'>('all');
  const [dewormingRecords, setDewormingRecords] = useState<DewormingRecord[]>([]);
  const [vaccineRecords, setVaccineRecords] = useState<PPRVaccinationRecord[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGoatsList = async () => {
    if (!user) return;
    try {
      // 1. Instant local load
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

      // 2. Background fresh load
      const freshGoats = await getFarmerGoats(user.id);
      const freshDeworm = await getAllDeworming();
      const freshVacc = await getAllVaccinations();

      setGoats(freshGoats);
      setDewormingRecords(freshDeworm);
      setVaccineRecords(freshVacc);
    } catch (error) {
      console.error('Error loading goats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoatsList();
  }, [user]);

  useEffect(() => {
    let result = goats;

    if (filter !== 'all') {
      result = result.filter((g) => g.status === filter);
    }

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
      if (goats.length === 0) {
        showToast('warning', 'No goats to export');
        return;
      }
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
        if (existing) {
          skippedCount++;
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
          sellerName: pg.sellerName,
          notes: pg.notes,
          photoURL: pg.photoURL,
          qrCode,
          barcode
        });

        if (pg.vaccinationStatus === 'vaccinated') {
          await recordVaccination(goatId, {
            goatId,
            vaccinationDate: pg.purchaseDate || new Date(),
            vaccineBrand: 'Imported',
            administeredBy: 'Import',
            status: 'vaccinated',
          });
        }

        if (pg.dewormingStatus === 'dewormed') {
          await recordDeworming(goatId, {
            goatId,
            dewormingDate: pg.purchaseDate || new Date(),
            medicineUsed: 'Imported',
            administeredBy: 'Import',
            status: 'dewormed',
          });
        }

        // Log sale info if present in Excel
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

        importedCount++;
      }

      showToast(
        'success',
        'Import completed!',
        `Imported: ${importedCount}, Skipped: ${skippedCount}`
      );

      await loadGoatsList();
    } catch (error: any) {
      showToast('error', 'Import failed', error.message);
    } finally {
      setImporting(false);
      if (e.target) {
        e.target.value = '';
      }
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Goats</h1>
          <p className="text-muted-foreground">Manage your goat inventory</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="flex items-center gap-2"
            disabled={loading || importing}
          >
            <Download className="h-4 w-4" /> Export Excel
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
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2"
            isLoading={importing}
            disabled={loading || importing}
          >
            <Upload className="h-4 w-4" /> Import Excel
          </Button>

          <Button
            variant="primary"
            onClick={() => navigate('/goats/register')}
            className="flex items-center gap-2"
            disabled={importing}
          >
            <Plus className="h-4 w-4" /> Register Goat
          </Button>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ear tag or variant..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex gap-2">
          {(['all', 'active', 'sold'] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f === 'all' ? 'All Goats' : f === 'active' ? 'Active' : 'Sold'}
            </Button>
          ))}
        </div>
      </div>

      {/* Goats Grid */}
      {filteredGoats.length === 0 ? (
        <EmptyState
          title="No goats found"
          description={searchTerm ? 'Try adjusting your search terms' : 'Register your first goat to get started'}
          action={
            <Button
              variant="primary"
              onClick={() => navigate('/goats/register')}
            >
              Register First Goat
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGoats.map((goat) => (
            <Card
              key={goat.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/goats`)}
            >
              <CardContent className="pt-6">
                {goat.photoURL && (
                  <img
                    src={goat.photoURL}
                    alt={goat.earTagNumber}
                    className="w-full h-40 object-cover rounded-lg mb-4"
                  />
                )}

                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">{goat.earTagNumber}</h3>
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${
                      goat.status === 'active' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
                    }`}>
                      {goat.status.charAt(0).toUpperCase() + goat.status.slice(1)}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {goat.variant} • {goat.gender.charAt(0).toUpperCase() + goat.gender.slice(1)}
                  </p>

                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Weight:</span> {goat.purchaseWeight} kg</p>
                    <p><span className="text-muted-foreground">Price:</span> ₹{goat.purchasePrice}</p>
                    
                    <p className="flex items-center gap-1.5 pt-1.5 border-t border-dashed border-gray-200 dark:border-gray-800 mt-2">
                      <span className="text-muted-foreground">Vaccine:</span>
                      <span className={`font-medium ${
                        getGoatVaccineStatus(goat.id) === 'Vaccinated' 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : 'text-red-500'
                      }`}>
                        {getGoatVaccineStatus(goat.id)}
                      </span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Deworming:</span>
                      <span className={`font-medium ${
                        getGoatDewormingStatus(goat.id) === 'Dewormed' 
                          ? 'text-blue-600 dark:text-blue-400' 
                          : 'text-orange-500'
                      }`}>
                        {getGoatDewormingStatus(goat.id)}
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
