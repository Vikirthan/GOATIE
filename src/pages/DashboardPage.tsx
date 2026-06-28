import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  getFarmerGoats,
  getGoatsDueForWeight,
  getPendingDeworming,
  getPendingVaccination,
  recordVaccination,
  recordDeworming,
  recordWeight,
  recordSale
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord } from '@/types';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [showVaccineModal, setShowVaccineModal] = useState(false);
  const [showDewormingModal, setShowDewormingModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [goatsList, setGoatsList] = useState<Goat[]>([]);

  const [stats, setStats] = useState({
    totalGoats: 0,
    activeGoats: 0,
    soldGoats: 0,
    weightDue: 0,
    pendingDeworming: 0,
    pendingVaccination: 0,
  });

  const [weightForm, setWeightForm] = useState({
    goatId: '',
    weightNumber: '1',
    weight: '',
    recordedDate: new Date().toISOString().split('T')[0],
    remarks: '',
  });

  const [vaccineForm, setVaccineForm] = useState({
    goatId: '',
    vaccineBrand: '',
    vaccinationDate: new Date().toISOString().split('T')[0],
    administeredBy: '',
    remarks: '',
  });

  const [dewormingForm, setDewormingForm] = useState({
    goatId: '',
    medicineUsed: '',
    dewormingDate: new Date().toISOString().split('T')[0],
    administeredBy: '',
    remarks: '',
  });

  const [saleForm, setSaleForm] = useState({
    goatId: '',
    saleDate: new Date().toISOString().split('T')[0],
    saleWeight: '',
    saleRatePerKg: '',
    buyerName: '',
    buyerContact: '',
    commission: '',
    transportCharges: '',
    otherCharges: '',
    remarks: '',
  });

  const loadData = async () => {
    if (!user) return;

    try {
      // 1. Instant local load from IndexedDB cache
      const localGoats = await indexedDB.getAllItems<Goat>('goats');
      const farmerGoats = localGoats.filter((g) => g.farmerId === user.id);
      const active = farmerGoats.filter((g) => g.status === 'active');
      const sold = farmerGoats.filter((g) => g.status === 'sold');
      
      const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
      const localDeworm = await indexedDB.getAllItems<DewormingRecord>('deworming');
      const localVacc = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');

      const now = new Date();
      const weightDueCount = active.filter((g) => {
        const w = localWeights.filter((wRecord) => wRecord.goatId === g.id);
        return w.some((weight) => !weight.isRecorded && new Date(weight.dueDate) <= now);
      }).length;

      const pendingDewormingCount = active.filter((g) => {
        const d = localDeworm.find((r) => r.goatId === g.id);
        return !d;
      }).length;

      const pendingVaccinationCount = active.filter((g) => {
        const v = localVacc.find((r) => r.goatId === g.id);
        return !v;
      }).length;

      setStats({
        totalGoats: farmerGoats.length,
        activeGoats: active.length,
        soldGoats: sold.length,
        weightDue: weightDueCount,
        pendingDeworming: pendingDewormingCount,
        pendingVaccination: pendingVaccinationCount,
      });
      setGoatsList(active);

      if (active.length > 0) {
        setWeightForm((prev) => ({ ...prev, goatId: active[0].id }));
        setVaccineForm((prev) => ({ ...prev, goatId: active[0].id }));
        setDewormingForm((prev) => ({ ...prev, goatId: active[0].id }));
        setSaleForm((prev) => ({ ...prev, goatId: active[0].id }));
      }

      setLoading(false); // Snappy first load render!

      // 2. Fetch fresh data in background from Sheets/Firestore
      const allGoats = await getFarmerGoats(user.id);
      const freshActive = allGoats.filter((g) => g.status === 'active');
      const freshSold = allGoats.filter((g) => g.status === 'sold');
      const weightDue = await getGoatsDueForWeight(user.id);
      const deworm = await getPendingDeworming(user.id);
      const vacc = await getPendingVaccination(user.id);

      setStats({
        totalGoats: allGoats.length,
        activeGoats: freshActive.length,
        soldGoats: freshSold.length,
        weightDue: weightDue.length,
        pendingDeworming: deworm.length,
        pendingVaccination: vacc.length,
      });
      setGoatsList(freshActive);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleWeightSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weightForm.goatId) {
      showToast('error', 'Please select a goat');
      return;
    }
    const parsedWeight = parseFloat(weightForm.weight);
    if (isNaN(parsedWeight) || parsedWeight <= 0) {
      showToast('error', 'Please enter a valid weight');
      return;
    }
    setSubmitting(true);
    try {
      await recordWeight(weightForm.goatId, {
        goatId: weightForm.goatId,
        weightNumber: parseInt(weightForm.weightNumber) as any,
        weight: parsedWeight,
        dueDate: new Date(), // overridden by existing placeholder in recordWeight
        recordedDate: new Date(weightForm.recordedDate),
        remarks: weightForm.remarks || undefined,
        isRecorded: true
      });
      showToast('success', 'Weight recorded successfully');
      setShowWeightModal(false);
      setWeightForm({
        goatId: goatsList[0]?.id || '',
        weightNumber: '1',
        weight: '',
        recordedDate: new Date().toISOString().split('T')[0],
        remarks: '',
      });
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record weight', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVaccineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaccineForm.goatId) {
      showToast('error', 'Please select a goat');
      return;
    }
    setSubmitting(true);
    try {
      await recordVaccination(vaccineForm.goatId, {
        goatId: vaccineForm.goatId,
        vaccinationDate: new Date(vaccineForm.vaccinationDate),
        vaccineBrand: vaccineForm.vaccineBrand,
        administeredBy: vaccineForm.administeredBy,
        remarks: vaccineForm.remarks || undefined,
        status: 'vaccinated'
      });
      showToast('success', 'Vaccination recorded successfully');
      setShowVaccineModal(false);
      setVaccineForm({
        goatId: goatsList[0]?.id || '',
        vaccineBrand: '',
        vaccinationDate: new Date().toISOString().split('T')[0],
        administeredBy: '',
        remarks: '',
      });
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record vaccination', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDewormingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dewormingForm.goatId) {
      showToast('error', 'Please select a goat');
      return;
    }
    setSubmitting(true);
    try {
      await recordDeworming(dewormingForm.goatId, {
        goatId: dewormingForm.goatId,
        dewormingDate: new Date(dewormingForm.dewormingDate),
        medicineUsed: dewormingForm.medicineUsed,
        administeredBy: dewormingForm.administeredBy,
        remarks: dewormingForm.remarks || undefined,
        status: 'dewormed'
      });
      showToast('success', 'Deworming recorded successfully');
      setShowDewormingModal(false);
      setDewormingForm({
        goatId: goatsList[0]?.id || '',
        medicineUsed: '',
        dewormingDate: new Date().toISOString().split('T')[0],
        administeredBy: '',
        remarks: '',
      });
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record deworming', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleForm.goatId) {
      showToast('error', 'Please select a goat');
      return;
    }

    const selectedGoat = goatsList.find((g) => g.id === saleForm.goatId);
    if (!selectedGoat) return;

    const saleWeight = parseFloat(saleForm.saleWeight);
    const saleRatePerKg = parseFloat(saleForm.saleRatePerKg);

    if (isNaN(saleWeight) || saleWeight <= 0 || isNaN(saleRatePerKg) || saleRatePerKg <= 0) {
      showToast('error', 'Please enter valid weight and rate');
      return;
    }

    setSubmitting(true);

    const saleAmount = saleWeight * saleRatePerKg;
    const commission = parseFloat(saleForm.commission) || 0;
    const transportCharges = parseFloat(saleForm.transportCharges) || 0;
    const otherCharges = parseFloat(saleForm.otherCharges) || 0;
    
    const netProfit = saleAmount - selectedGoat.purchasePrice - (commission + transportCharges + otherCharges);
    const profitPercentage = selectedGoat.purchasePrice > 0 ? (netProfit / selectedGoat.purchasePrice) * 100 : 0;

    try {
      await recordSale(saleForm.goatId, {
        goatId: saleForm.goatId,
        saleDate: new Date(saleForm.saleDate),
        saleWeight,
        saleRatePerKg,
        buyerName: saleForm.buyerName,
        buyerContact: saleForm.buyerContact || undefined,
        saleAmount,
        commission: commission || undefined,
        transportCharges: transportCharges || undefined,
        otherCharges: otherCharges || undefined,
        netProfit,
        profitPercentage,
        remarks: saleForm.remarks || undefined,
      });

      showToast('success', 'Sale recorded successfully');
      setShowSaleModal(false);
      setSaleForm({
        goatId: goatsList[0]?.id || '',
        saleDate: new Date().toISOString().split('T')[0],
        saleWeight: '',
        saleRatePerKg: '',
        buyerName: '',
        buyerContact: '',
        commission: '',
        transportCharges: '',
        otherCharges: '',
        remarks: '',
      });
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record sale', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  const statCards = [
    { title: 'Total Goats', value: stats.totalGoats, color: 'bg-blue-500' },
    { title: 'Active Goats', value: stats.activeGoats, color: 'bg-green-500' },
    { title: 'Sold Goats', value: stats.soldGoats, color: 'bg-purple-500' },
    { title: 'Weight Due', value: stats.weightDue, color: 'bg-orange-500' },
    { title: 'Pending Deworming', value: stats.pendingDeworming, color: 'bg-red-500' },
    { title: 'Pending Vaccination', value: stats.pendingVaccination, color: 'bg-yellow-500' },
  ];

  // Helper values for live calculations in Sale Modal
  const selectedGoatForSale = goatsList.find((g) => g.id === saleForm.goatId);
  const purchasePrice = selectedGoatForSale ? selectedGoatForSale.purchasePrice : 0;
  const saleWeightVal = parseFloat(saleForm.saleWeight) || 0;
  const saleRateVal = parseFloat(saleForm.saleRatePerKg) || 0;
  const computedSaleAmount = saleWeightVal * saleRateVal;
  const computedCommission = parseFloat(saleForm.commission) || 0;
  const computedTransport = parseFloat(saleForm.transportCharges) || 0;
  const computedOther = parseFloat(saleForm.otherCharges) || 0;
  const computedNetProfit = computedSaleAmount - purchasePrice - (computedCommission + computedTransport + computedOther);

  return (
    <div className="space-y-8 relative">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {user?.displayName}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold mt-2">{stat.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-lg ${stat.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Sales Trend</CardTitle>
            <CardDescription>Goat sales over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={[
                { month: 'Jan', sales: 4 },
                { month: 'Feb', sales: 6 },
                { month: 'Mar', sales: 5 },
                { month: 'Apr', sales: 8 },
                { month: 'May', sales: 7 },
                { month: 'Jun', sales: 9 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Goat Distribution</CardTitle>
            <CardDescription>Active vs Sold goats</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[
                { name: 'Active', value: stats.activeGoats },
                { name: 'Sold', value: stats.soldGoats },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <Button
          variant="primary"
          size="md"
          className="w-full h-12"
          onClick={() => navigate('/goats/register')}
        >
          Register New Goat
        </Button>
        <Button
          variant="secondary"
          size="md"
          className="w-full h-12"
          onClick={() => setShowWeightModal(true)}
          disabled={goatsList.length === 0}
        >
          Record Weight
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full h-12 text-emerald-600 border-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-400"
          onClick={() => setShowVaccineModal(true)}
          disabled={goatsList.length === 0}
        >
          Log Vaccine
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full h-12 text-blue-600 border-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-400"
          onClick={() => setShowDewormingModal(true)}
          disabled={goatsList.length === 0}
        >
          Log Deworming
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full h-12 text-purple-600 border-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-400"
          onClick={() => setShowSaleModal(true)}
          disabled={goatsList.length === 0}
        >
          Sell Goat
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full h-12"
          onClick={() => navigate('/goats')}
        >
          View All Goats
        </Button>
      </div>

      {/* Weight Modal */}
      {showWeightModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <CardTitle>Record Weight</CardTitle>
              <CardDescription>Enter monthly weight recording details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleWeightSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="weightGoat">Select Goat (Ear Tag)</Label>
                  <Select
                    id="weightGoat"
                    options={goatsList.map((g) => ({ value: g.id, label: g.earTagNumber }))}
                    value={weightForm.goatId}
                    onChange={(val) => setWeightForm({ ...weightForm, goatId: val })}
                  />
                </div>
                <div>
                  <Label htmlFor="weightNumber">Select Month</Label>
                  <Select
                    id="weightNumber"
                    options={[
                      { value: '1', label: '1st Month' },
                      { value: '2', label: '2nd Month' },
                      { value: '3', label: '3rd Month' },
                      { value: '4', label: '4th Month' }
                    ]}
                    value={weightForm.weightNumber}
                    onChange={(val) => setWeightForm({ ...weightForm, weightNumber: val })}
                  />
                </div>
                <div>
                  <Label htmlFor="weight">Weight (kg)</Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.01"
                    placeholder="Enter weight in kg"
                    value={weightForm.weight}
                    onChange={(e) => setWeightForm({ ...weightForm, weight: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="recordedDate">Date Recorded</Label>
                  <Input
                    id="recordedDate"
                    type="date"
                    value={weightForm.recordedDate}
                    onChange={(e) => setWeightForm({ ...weightForm, recordedDate: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="weightRemarks">Remarks</Label>
                  <Input
                    id="weightRemarks"
                    placeholder="Optional remarks"
                    value={weightForm.remarks}
                    onChange={(e) => setWeightForm({ ...weightForm, remarks: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" type="button" onClick={() => setShowWeightModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>
                    Record Weight
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Vaccine Modal */}
      {showVaccineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <CardTitle>Log Vaccine</CardTitle>
              <CardDescription>Record a vaccination entry for a goat</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVaccineSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="vaccineGoat">Select Goat (Ear Tag)</Label>
                  <Select
                    id="vaccineGoat"
                    options={goatsList.map((g) => ({ value: g.id, label: g.earTagNumber }))}
                    value={vaccineForm.goatId}
                    onChange={(val) => setVaccineForm({ ...vaccineForm, goatId: val })}
                  />
                </div>
                <div>
                  <Label htmlFor="vaccineBrand">Vaccine Brand</Label>
                  <Input
                    id="vaccineBrand"
                    placeholder="Enter vaccine brand/name"
                    value={vaccineForm.vaccineBrand}
                    onChange={(e) => setVaccineForm({ ...vaccineForm, vaccineBrand: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="vaccineDate">Vaccination Date</Label>
                  <Input
                    id="vaccineDate"
                    type="date"
                    value={vaccineForm.vaccinationDate}
                    onChange={(e) => setVaccineForm({ ...vaccineForm, vaccinationDate: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="vaccineAdmin">Administered By</Label>
                  <Input
                    id="vaccineAdmin"
                    placeholder="Doctor or farmer name"
                    value={vaccineForm.administeredBy}
                    onChange={(e) => setVaccineForm({ ...vaccineForm, administeredBy: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="vaccineRemarks">Remarks</Label>
                  <Input
                    id="vaccineRemarks"
                    placeholder="Optional remarks"
                    value={vaccineForm.remarks}
                    onChange={(e) => setVaccineForm({ ...vaccineForm, remarks: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" type="button" onClick={() => setShowVaccineModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>
                    Log Vaccine
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Deworming Modal */}
      {showDewormingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <CardTitle>Log Deworming</CardTitle>
              <CardDescription>Record a deworming entry for a goat</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDewormingSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="dewormingGoat">Select Goat (Ear Tag)</Label>
                  <Select
                    id="dewormingGoat"
                    options={goatsList.map((g) => ({ value: g.id, label: g.earTagNumber }))}
                    value={dewormingForm.goatId}
                    onChange={(val) => setDewormingForm({ ...dewormingForm, goatId: val })}
                  />
                </div>
                <div>
                  <Label htmlFor="medicineUsed">Medicine Used</Label>
                  <Input
                    id="medicineUsed"
                    placeholder="Enter medicine used"
                    value={dewormingForm.medicineUsed}
                    onChange={(e) => setDewormingForm({ ...dewormingForm, medicineUsed: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="dewormingDate">Deworming Date</Label>
                  <Input
                    id="dewormingDate"
                    type="date"
                    value={dewormingForm.dewormingDate}
                    onChange={(e) => setDewormingForm({ ...dewormingForm, dewormingDate: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="dewormingAdmin">Administered By</Label>
                  <Input
                    id="dewormingAdmin"
                    placeholder="Doctor or farmer name"
                    value={dewormingForm.administeredBy}
                    onChange={(e) => setDewormingForm({ ...dewormingForm, administeredBy: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="dewormingRemarks">Remarks</Label>
                  <Input
                    id="dewormingRemarks"
                    placeholder="Optional remarks"
                    value={dewormingForm.remarks}
                    onChange={(e) => setDewormingForm({ ...dewormingForm, remarks: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" type="button" onClick={() => setShowDewormingModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>
                    Log Deworming
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sell Goat Modal */}
      {showSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-md bg-card shadow-2xl my-8">
            <CardHeader>
              <CardTitle>Sell Goat</CardTitle>
              <CardDescription>Record sale details and calculate profit</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="saleGoat">Select Goat (Ear Tag)</Label>
                  <Select
                    id="saleGoat"
                    options={goatsList.map((g) => ({ value: g.id, label: g.earTagNumber }))}
                    value={saleForm.goatId}
                    onChange={(val) => setSaleForm({ ...saleForm, goatId: val })}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="saleWeight">Sale Weight (kg)</Label>
                    <Input
                      id="saleWeight"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={saleForm.saleWeight}
                      onChange={(e) => setSaleForm({ ...saleForm, saleWeight: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="saleRatePerKg">Rate per kg (₹)</Label>
                    <Input
                      id="saleRatePerKg"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={saleForm.saleRatePerKg}
                      onChange={(e) => setSaleForm({ ...saleForm, saleRatePerKg: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="buyerName">Buyer Name</Label>
                  <Input
                    id="buyerName"
                    placeholder="Enter buyer name"
                    value={saleForm.buyerName}
                    onChange={(e) => setSaleForm({ ...saleForm, buyerName: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="buyerContact">Buyer Contact (Optional)</Label>
                  <Input
                    id="buyerContact"
                    placeholder="Phone or email"
                    value={saleForm.buyerContact}
                    onChange={(e) => setSaleForm({ ...saleForm, buyerContact: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor="commission" className="text-xs">Commission (₹)</Label>
                    <Input
                      id="commission"
                      type="number"
                      placeholder="0"
                      value={saleForm.commission}
                      onChange={(e) => setSaleForm({ ...saleForm, commission: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="transportCharges" className="text-xs">Transport (₹)</Label>
                    <Input
                      id="transportCharges"
                      type="number"
                      placeholder="0"
                      value={saleForm.transportCharges}
                      onChange={(e) => setSaleForm({ ...saleForm, transportCharges: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="otherCharges" className="text-xs">Other (₹)</Label>
                    <Input
                      id="otherCharges"
                      type="number"
                      placeholder="0"
                      value={saleForm.otherCharges}
                      onChange={(e) => setSaleForm({ ...saleForm, otherCharges: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="saleDate">Sale Date</Label>
                  <Input
                    id="saleDate"
                    type="date"
                    value={saleForm.saleDate}
                    onChange={(e) => setSaleForm({ ...saleForm, saleDate: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="saleRemarks">Remarks</Label>
                  <Input
                    id="saleRemarks"
                    placeholder="Optional remarks"
                    value={saleForm.remarks}
                    onChange={(e) => setSaleForm({ ...saleForm, remarks: e.target.value })}
                  />
                </div>

                <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Purchase Price:</span>
                    <span className="font-semibold">₹{purchasePrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sale Amount:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">₹{computedSaleAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 border-dashed mt-1">
                    <span>Net Profit:</span>
                    <span className={`font-bold ${computedNetProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      ₹{computedNetProfit.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowSaleModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>
                    Record Sale
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
