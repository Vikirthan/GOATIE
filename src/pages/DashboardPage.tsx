import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
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
  recordSale,
  getGoatWeights,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { supabase } from '@/lib/supabase';
import { getAllWeights } from '@/services/supabaseService';
import { Goat, WeightRecord } from '@/types';
import {
  Plus, Scale, Syringe, Bug, ShoppingCart, List,
  ChevronRight, TrendingUp, TrendingDown, X, Search, AlertCircle, Tag
} from 'lucide-react';

const GoatSearchDropdown = ({
  refEl, searchVal, setSearch, showDropdown, setShowDropdown,
  formGoatId, setFormGoatId, placeholder, id, goatsList
}: {
  refEl: React.RefObject<HTMLDivElement | null>;
  searchVal: string;
  setSearch: (v: string) => void;
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
  formGoatId: string;
  setFormGoatId: (id: string, tag: string) => void;
  placeholder: string;
  id: string;
  goatsList: Goat[];
}) => (
  <div ref={refEl} className="relative">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        id={id}
        inputMode="numeric"
        className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        placeholder={placeholder}
        value={searchVal}
        onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        autoComplete="off"
      />
    </div>
    {showDropdown && (
      <div className="absolute z-20 w-full bg-card border border-input rounded-lg mt-1 max-h-44 overflow-y-auto shadow-xl">
        {goatsList
          .filter((g) => String(g.earTagNumber || '').toLowerCase().includes((searchVal || '').toLowerCase()))
          .map((g) => (
            <div
              key={g.id}
              className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent text-sm transition-colors ${g.id === formGoatId ? 'bg-primary/10 font-semibold' : ''}`}
              onClick={() => { setFormGoatId(g.id, g.earTagNumber); setSearch(g.earTagNumber); setShowDropdown(false); }}
            >
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>{g.earTagNumber}</span>
              <span className="text-muted-foreground text-xs ml-auto">{g.variant}</span>
            </div>
          ))}
        {goatsList.filter((g) => String(g.earTagNumber || '').toLowerCase().includes((searchVal || '').toLowerCase())).length === 0 && (
          <div className="px-3 py-2.5 text-sm text-muted-foreground">No matching goats found</div>
        )}
      </div>
    )}
  </div>
);


export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [showWeightModal, setShowWeightModal] = useState(false);
  const [showVaccineModal, setShowVaccineModal] = useState(false);
  const [showDewormingModal, setShowDewormingModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showWeightDueModal, setShowWeightDueModal] = useState(false);

  const [goatsList, setGoatsList] = useState<Goat[]>([]);
  const [salesChartData, setSalesChartData] = useState<{ month: string; sales: number }[]>([]);
  const [weightDueGoats, setWeightDueGoats] = useState<{ goat: Goat; weight: WeightRecord }[]>([]);
  const [weightDueSearch, setWeightDueSearch] = useState('');

  // Searchable goat selectors
  const vaccineRef = useRef<HTMLDivElement>(null);
  const dewormingRef = useRef<HTMLDivElement>(null);
  const weightRef = useRef<HTMLDivElement>(null);
  const saleRef = useRef<HTMLDivElement>(null);

  const [vaccineSearch, setVaccineSearch] = useState('');
  const [showVaccineDropdown, setShowVaccineDropdown] = useState(false);
  const [dewormingSearch, setDewormingSearch] = useState('');
  const [showDewormingDropdown, setShowDewormingDropdown] = useState(false);
  const [weightGoatSearch, setWeightGoatSearch] = useState('');
  const [showWeightGoatDropdown, setShowWeightGoatDropdown] = useState(false);
  const [saleGoatSearch, setSaleGoatSearch] = useState('');
  const [showSaleGoatDropdown, setShowSaleGoatDropdown] = useState(false);

  // Filtered dropdown states
  const [pendingDewormingGoats, setPendingDewormingGoats] = useState<Goat[]>([]);
  const [pendingVaccinationGoats, setPendingVaccinationGoats] = useState<Goat[]>([]);
  const [allWeights, setAllWeights] = useState<WeightRecord[]>([]);

  // Weight gain display
  const [prevWeight, setPrevWeight] = useState<number | null>(null);

  const [stats, setStats] = useState({
    totalGoats: 0,
    activeGoats: 0,
    soldGoats: 0,
    weightDue: 0,
    pendingDeworming: 0,
    pendingVaccination: 0,
    semmariWeight: 0,
    velladuWeight: 0,
  });

  const [weightForm, setWeightForm] = useState({
    goatId: '',
    weightNumber: '1',
    weight: '',
    recordedDate: new Date().toISOString().split('T')[0],
  });

  const [vaccineForm, setVaccineForm] = useState({
    goatId: '',
    vaccinationDate: new Date().toISOString().split('T')[0],
  });

  const [dewormingForm, setDewormingForm] = useState({
    goatId: '',
    dewormingDate: new Date().toISOString().split('T')[0],
  });

  const [saleForm, setSaleForm] = useState({
    goatId: '',
    saleDate: new Date().toISOString().split('T')[0],
    saleWeight: '',
    saleRatePerKg: '',
    saleTotalPrice: '',
    remarks: '',
  });

  const getNextAvailableMonth = (goatId: string, weights: WeightRecord[]) => {
    const goatWeights = weights.filter(w => w.goatId === goatId && w.isRecorded);
    const recordedMonths = goatWeights.map(w => Number(w.weightNumber));
    const available = [['1', '1st Month'], ['2', '2nd Month'], ['3', '3rd Month'], ['4', '4th Month']]
      .filter(([v]) => !recordedMonths.includes(Number(v)));
    return available.length > 0 ? available[0][0] : '1';
  };

  const getLast6Months = () => {
    const months = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({ month: monthNames[d.getMonth()], year: d.getFullYear(), monthIndex: d.getMonth(), sales: 0 });
    }
    return months;
  };

  const computeTrend = (goats: Goat[]) => {
    const trend = getLast6Months();
    goats.forEach((goat) => {
      if (goat.status === 'sold' && goat.saleInfo) {
        const saleDate = new Date(goat.saleInfo.saleDate);
        const match = trend.find((m) => m.monthIndex === saleDate.getMonth() && m.year === saleDate.getFullYear());
        if (match) match.sales += 1;
      }
    });
    return trend.map((t) => ({ month: t.month, sales: t.sales }));
  };

  const loadData = async () => {
    if (!user) return;
    try {
      setLoading(true);

      const localGoats = await indexedDB.getAllItems<Goat>('goats');
      const farmerGoats = localGoats.filter((g) => g.farmerId === user.id);
      if (farmerGoats.length > 0) {
        const active = farmerGoats.filter((g) => g.status === 'active');
        const sold = farmerGoats.filter((g) => g.status === 'sold');
        setStats((prev) => ({ ...prev, totalGoats: farmerGoats.length, activeGoats: active.length, soldGoats: sold.length }));
        setGoatsList(active);
        setSalesChartData(computeTrend(farmerGoats));
        setLoading(false);
      }

      const allGoats = await getFarmerGoats(user.id);
      const freshActive = allGoats.filter((g) => g.status === 'active');
      const freshSold = allGoats.filter((g) => g.status === 'sold');
      const [weightDue, deworm, vacc, localWeights] = await Promise.all([
        getGoatsDueForWeight(user.id),
        getPendingDeworming(user.id),
        getPendingVaccination(user.id),
        isSupabaseEnabled() ? getAllWeights() : indexedDB.getAllItems<WeightRecord>('weights'),
      ]);

      let semmariWeight = 0;
      let velladuWeight = 0;

      freshActive.forEach((goat) => {
        const goatWeights = localWeights
          .filter((w) => w.goatId === goat.id && w.isRecorded && w.weight > 0)
          .sort((a, b) => {
            const timeA = new Date(a.recordedDate || a.createdAt).getTime();
            const timeB = new Date(b.recordedDate || b.createdAt).getTime();
            return timeB - timeA;
          });
        
        const currentWeight = goatWeights.length > 0 ? goatWeights[0].weight : goat.purchaseWeight;
        const variant = (goat.variant || '').trim().toLowerCase();

        if (variant.includes('semmari')) {
           semmariWeight += Number(currentWeight) || 0;
        } else if (variant.includes('velladu')) {
           velladuWeight += Number(currentWeight) || 0;
        }
      });

      setStats({
        totalGoats: allGoats.length,
        activeGoats: freshActive.length,
        soldGoats: freshSold.length,
        weightDue: weightDue.length,
        pendingDeworming: deworm.length,
        pendingVaccination: vacc.length,
        semmariWeight: parseFloat(semmariWeight.toFixed(2)),
        velladuWeight: parseFloat(velladuWeight.toFixed(2)),
      });
      setGoatsList(freshActive);
      setPendingDewormingGoats(deworm);
      setPendingVaccinationGoats(vacc);
      setAllWeights(localWeights);
      setWeightDueGoats(weightDue);
      setSalesChartData(computeTrend(allGoats));

      if (freshActive.length > 0) {
        const first = freshActive[0];
        setWeightGoatSearch(first.earTagNumber);
        setSaleGoatSearch(first.earTagNumber);
        setWeightForm((prev) => ({ ...prev, goatId: first.id, weightNumber: getNextAvailableMonth(first.id, localWeights) }));
        setSaleForm((prev) => ({ ...prev, goatId: first.id }));
      }
      if (vacc.length > 0) {
        setVaccineSearch(vacc[0].earTagNumber);
        setVaccineForm((prev) => ({ ...prev, goatId: vacc[0].id }));
      } else {
        setVaccineSearch('');
        setVaccineForm((prev) => ({ ...prev, goatId: '' }));
      }
      if (deworm.length > 0) {
        setDewormingSearch(deworm[0].earTagNumber);
        setDewormingForm((prev) => ({ ...prev, goatId: deworm[0].id }));
      } else {
        setDewormingSearch('');
        setDewormingForm((prev) => ({ ...prev, goatId: '' }));
      }
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const handleSync = () => loadData();
    window.addEventListener('data-synced', handleSync);

    if (isSupabaseEnabled()) {
      const channel = supabase
        .channel('public:dashboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'goats' }, () => {
          loadData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, () => {
          loadData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deworming' }, () => {
          loadData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vaccinations' }, () => {
          loadData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
          loadData();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
        window.removeEventListener('data-synced', handleSync);
      };
    }

    return () => {
      window.removeEventListener('data-synced', handleSync);
    };
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (vaccineRef.current && !vaccineRef.current.contains(event.target as Node)) setShowVaccineDropdown(false);
      if (dewormingRef.current && !dewormingRef.current.contains(event.target as Node)) setShowDewormingDropdown(false);
      if (weightRef.current && !weightRef.current.contains(event.target as Node)) setShowWeightGoatDropdown(false);
      if (saleRef.current && !saleRef.current.contains(event.target as Node)) setShowSaleGoatDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!weightForm.goatId || !weightForm.weightNumber) { setPrevWeight(null); return; }
    const fetchPrev = async () => {
      try {
        const weights = await getGoatWeights(weightForm.goatId);
        const wNum = parseInt(weightForm.weightNumber);
        const prev = weights
          .filter((w) => w.isRecorded && w.weight > 0 && w.weightNumber < wNum)
          .sort((a, b) => b.weightNumber - a.weightNumber)[0];
        setPrevWeight(prev ? prev.weight : null);
      } catch {
        setPrevWeight(null);
      }
    };
    fetchPrev();
  }, [weightForm.goatId, weightForm.weightNumber]);

  const handleSaleTotalPriceChange = (val: string) => {
    const total = parseFloat(val);
    const weight = parseFloat(saleForm.saleWeight);
    const perKg = total > 0 && weight > 0 ? (total / weight).toFixed(2) : '';
    setSaleForm({ ...saleForm, saleTotalPrice: val, saleRatePerKg: perKg });
  };

  const handleSaleRatePerKgChange = (val: string) => {
    const rate = parseFloat(val);
    const weight = parseFloat(saleForm.saleWeight);
    const total = rate > 0 && weight > 0 ? (rate * weight).toFixed(2) : '';
    setSaleForm({ ...saleForm, saleRatePerKg: val, saleTotalPrice: total });
  };

  const handleSaleWeightChange = (val: string) => {
    const weight = parseFloat(val);
    if (saleForm.saleRatePerKg) {
      const rate = parseFloat(saleForm.saleRatePerKg);
      const total = rate > 0 && weight > 0 ? (rate * weight).toFixed(2) : '';
      setSaleForm({ ...saleForm, saleWeight: val, saleTotalPrice: total });
    } else if (saleForm.saleTotalPrice) {
      const total = parseFloat(saleForm.saleTotalPrice);
      const perKg = total > 0 && weight > 0 ? (total / weight).toFixed(2) : '';
      setSaleForm({ ...saleForm, saleWeight: val, saleRatePerKg: perKg });
    } else {
      setSaleForm({ ...saleForm, saleWeight: val });
    }
  };

  const handleWeightSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weightForm.goatId) { showToast('error', 'Please select a goat'); return; }
    const parsedWeight = parseFloat(weightForm.weight);
    if (isNaN(parsedWeight) || parsedWeight <= 0) { showToast('error', 'Please enter a valid weight'); return; }
    setSubmitting(true);
    try {
      await recordWeight(weightForm.goatId, {
        goatId: weightForm.goatId,
        weightNumber: parseInt(weightForm.weightNumber) as any,
        weight: parsedWeight,
        dueDate: new Date(),
        recordedDate: new Date(weightForm.recordedDate),
        isRecorded: true,
      });
      showToast('success', 'Weight recorded successfully');
      setShowWeightModal(false);
      setWeightForm({ goatId: goatsList[0]?.id || '', weightNumber: goatsList[0] ? getNextAvailableMonth(goatsList[0].id, allWeights) : '1', weight: '', recordedDate: new Date().toISOString().split('T')[0] });
      setPrevWeight(null);
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record weight', error.message);
    } finally { setSubmitting(false); }
  };

  const handleVaccineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaccineForm.goatId) { showToast('error', 'Please search and select a valid goat'); return; }
    setSubmitting(true);
    try {
      await recordVaccination(vaccineForm.goatId, {
        goatId: vaccineForm.goatId,
        vaccinationDate: new Date(vaccineForm.vaccinationDate),
        status: 'vaccinated',
      });
      showToast('success', 'Vaccination recorded successfully');
      setShowVaccineModal(false);
      setVaccineForm({ goatId: goatsList[0]?.id || '', vaccinationDate: new Date().toISOString().split('T')[0] });
      setVaccineSearch(goatsList[0]?.earTagNumber || '');
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record vaccination', error.message);
    } finally { setSubmitting(false); }
  };

  const handleDewormingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dewormingForm.goatId) { showToast('error', 'Please search and select a valid goat'); return; }
    setSubmitting(true);
    try {
      await recordDeworming(dewormingForm.goatId, {
        goatId: dewormingForm.goatId,
        dewormingDate: new Date(dewormingForm.dewormingDate),
        status: 'dewormed',
      });
      showToast('success', 'Deworming recorded successfully');
      setShowDewormingModal(false);
      setDewormingForm({ goatId: goatsList[0]?.id || '', dewormingDate: new Date().toISOString().split('T')[0] });
      setDewormingSearch(goatsList[0]?.earTagNumber || '');
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record deworming', error.message);
    } finally { setSubmitting(false); }
  };

  const handleSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleForm.goatId) { showToast('error', 'Please select a goat'); return; }
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
    const netProfit = saleAmount - selectedGoat.purchasePrice;
    const profitPercentage = selectedGoat.purchasePrice > 0 ? (netProfit / selectedGoat.purchasePrice) * 100 : 0;

    try {
      await recordSale(saleForm.goatId, {
        goatId: saleForm.goatId,
        saleDate: new Date(saleForm.saleDate),
        saleWeight,
        saleRatePerKg,
        saleAmount,
        netProfit,
        profitPercentage,
        buyerName: 'N/A',
        remarks: saleForm.remarks || undefined,
      });
      showToast('success', 'Sale recorded successfully');
      setShowSaleModal(false);
      setSaleForm({
        goatId: goatsList[0]?.id || '',
        saleDate: new Date().toISOString().split('T')[0],
        saleWeight: '', saleRatePerKg: '', saleTotalPrice: '',
        remarks: '',
      });
      loadData();
    } catch (error: any) {
      showToast('error', 'Failed to record sale', error.message);
    } finally { setSubmitting(false); }
  };

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  const selectedGoatForSale = goatsList.find((g) => g.id === saleForm.goatId);
  const purchasePrice = selectedGoatForSale ? selectedGoatForSale.purchasePrice : 0;
  const saleWeightVal = parseFloat(saleForm.saleWeight) || 0;
  const saleRateVal = parseFloat(saleForm.saleRatePerKg) || 0;
  const computedSaleAmount = saleWeightVal * saleRateVal;
  const computedNetProfit = computedSaleAmount - purchasePrice;

  const currentWeightVal = parseFloat(weightForm.weight) || 0;
  const weightGainVal = prevWeight !== null && currentWeightVal > 0 ? currentWeightVal - prevWeight : null;

  const filteredWeightDue = weightDueGoats.filter((item) =>
    item.goat.earTagNumber.toLowerCase().includes(weightDueSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 relative">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, <span className="font-medium text-foreground">{user?.displayName}</span></p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Register Goat', icon: <Plus className="h-5 w-5" />, color: 'bg-emerald-500 hover:bg-emerald-600 text-white', action: () => navigate('/goats/register') },
            { label: 'Record Weight', icon: <Scale className="h-5 w-5" />, color: 'bg-cyan-500 hover:bg-cyan-600 text-white', action: () => setShowWeightModal(true), disabled: goatsList.length === 0 },
            { label: 'Log Vaccine', icon: <Syringe className="h-5 w-5" />, color: 'bg-violet-500 hover:bg-violet-600 text-white', action: () => setShowVaccineModal(true), disabled: goatsList.length === 0 },
            { label: 'Log Deworming', icon: <Bug className="h-5 w-5" />, color: 'bg-blue-500 hover:bg-blue-600 text-white', action: () => setShowDewormingModal(true), disabled: goatsList.length === 0 },
            { label: 'Sell Goat', icon: <ShoppingCart className="h-5 w-5" />, color: 'bg-amber-500 hover:bg-amber-600 text-white', action: () => setShowSaleModal(true), disabled: goatsList.length === 0 },
            { label: 'View All Goats', icon: <List className="h-5 w-5" />, color: 'bg-slate-600 hover:bg-slate-700 text-white', action: () => navigate('/goats') },
          ].map(({ label, icon, color, action, disabled }) => (
            <button
              key={label}
              onClick={action}
              disabled={disabled}
              className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl font-medium text-sm transition-all duration-200 shadow-sm active:scale-95 ${color} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100`}
            >
              {icon}
              <span className="leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { title: 'Total Goats', value: stats.totalGoats, gradient: 'from-blue-500/20 via-blue-500/10 to-transparent', border: 'border-blue-500/20', text: 'text-blue-600 dark:text-blue-400', onClick: undefined },
          { title: 'Active', value: stats.activeGoats, gradient: 'from-emerald-500/20 via-emerald-500/10 to-transparent', border: 'border-emerald-500/20', text: 'text-emerald-600 dark:emerald-400', onClick: undefined },
          { title: 'Sold', value: stats.soldGoats, gradient: 'from-amber-500/20 via-amber-500/10 to-transparent', border: 'border-amber-500/20', text: 'text-amber-600 dark:text-amber-400', onClick: undefined },
          { title: 'Weight Due', value: stats.weightDue, gradient: 'from-orange-500/20 via-orange-500/10 to-transparent', border: 'border-orange-500/20', text: 'text-orange-600 dark:text-orange-400', onClick: () => setShowWeightDueModal(true) },
          { title: 'Pending Deworm', value: stats.pendingDeworming, gradient: 'from-red-500/20 via-red-500/10 to-transparent', border: 'border-red-500/20', text: 'text-red-600 dark:text-red-400', onClick: undefined },
          { title: 'Pending Vaccine', value: stats.pendingVaccination, gradient: 'from-yellow-500/20 via-yellow-500/10 to-transparent', border: 'border-yellow-500/20', text: 'text-yellow-600 dark:text-yellow-400', onClick: undefined },
          { title: 'Semmari Wt (kg)', value: stats.semmariWeight, gradient: 'from-cyan-500/20 via-cyan-500/10 to-transparent', border: 'border-cyan-500/20', text: 'text-cyan-600 dark:text-cyan-400', onClick: undefined },
          { title: 'Velladu Wt (kg)', value: stats.velladuWeight, gradient: 'from-purple-500/20 via-purple-500/10 to-transparent', border: 'border-purple-500/20', text: 'text-purple-600 dark:text-purple-400', onClick: undefined },
        ].map((stat) => (
          <div
            key={stat.title}
            onClick={stat.onClick}
            className={`rounded-xl border ${stat.border} bg-gradient-to-br ${stat.gradient} p-4 backdrop-blur-sm transition-all duration-200 ${stat.onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]' : ''}`}
          >
            <p className="text-xs font-medium text-muted-foreground truncate">{stat.title}</p>
            <p className={`text-3xl font-bold mt-1 ${stat.text}`}>{stat.value}</p>
            {stat.onClick && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-muted-foreground">View list</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Sales Trend</CardTitle>
            <CardDescription>Goat sales over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={salesChartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
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
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { name: 'Active', value: stats.activeGoats },
                { name: 'Sold', value: stats.soldGoats },
              ]} barSize={48}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {showWeightDueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-orange-500" />
                    Weight Due
                  </CardTitle>
                  <CardDescription>{weightDueGoats.length} goat(s) need weight recording</CardDescription>
                </div>
                <button onClick={() => setShowWeightDueModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Search goat by ear tag..."
                  value={weightDueSearch}
                  onChange={(e) => setWeightDueSearch(e.target.value)}
                />
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {filteredWeightDue.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No matching goats</p>
                ) : filteredWeightDue.map(({ goat, weight }) => (
                  <button
                    key={goat.id + weight.weightNumber}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent hover:border-primary/30 transition-all text-left group"
                    onClick={() => {
                      setWeightForm({
                        goatId: goat.id,
                        weightNumber: String(weight.weightNumber),
                        weight: '',
                        recordedDate: new Date().toISOString().split('T')[0],
                      });
                      setWeightGoatSearch(goat.earTagNumber);
                      setShowWeightDueModal(false);
                      setShowWeightModal(true);
                    }}
                  >
                    <div>
                      <span className="font-semibold text-sm">{goat.earTagNumber}</span>
                      <span className="text-xs text-muted-foreground ml-2">{goat.variant}</span>
                      <p className="text-xs text-orange-500 mt-0.5">Weight {weight.weightNumber} overdue since {new Date(weight.dueDate).toLocaleDateString('en-IN')}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showWeightModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Record Weight</CardTitle>
                  <CardDescription>Enter monthly weight recording details</CardDescription>
                </div>
                <button onClick={() => setShowWeightModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleWeightSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="weightGoatSearch">Search Goat (Ear Tag)</Label>
                  <GoatSearchDropdown
                    refEl={weightRef}
                    searchVal={weightGoatSearch}
                    setSearch={setWeightGoatSearch}
                    showDropdown={showWeightGoatDropdown}
                    setShowDropdown={setShowWeightGoatDropdown}
                    formGoatId={weightForm.goatId}
                    setFormGoatId={(id, tag) => { 
                      setWeightForm({ ...weightForm, goatId: id, weightNumber: getNextAvailableMonth(id, allWeights) }); 
                      setWeightGoatSearch(tag); 
                    }}
                    placeholder="Type ear tag number..."
                    id="weightGoatSearch"
                    goatsList={goatsList}
                  />
                </div>

                <div>
                  <Label htmlFor="weightNumber">Select Month</Label>
                  <select
                    id="weightNumber"
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    value={weightForm.weightNumber}
                    onChange={(e) => setWeightForm({ ...weightForm, weightNumber: e.target.value })}
                  >
                    {[['1', '1st Month'], ['2', '2nd Month'], ['3', '3rd Month'], ['4', '4th Month']]
                      .filter(([v]) => !allWeights.some(w => w.goatId === weightForm.goatId && w.isRecorded && Number(w.weightNumber) === Number(v)))
                      .map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>

                {prevWeight !== null && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 text-sm">
                    <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Previous weight:</span>
                    <span className="font-semibold">{prevWeight} kg</span>
                  </div>
                )}

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
                  {weightGainVal !== null && weightForm.weight && (
                    <div className={`flex items-center gap-1.5 mt-1.5 text-sm font-semibold ${weightGainVal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                      {weightGainVal >= 0
                        ? <TrendingUp className="h-4 w-4" />
                        : <TrendingDown className="h-4 w-4" />
                      }
                      Weight Gain: {weightGainVal >= 0 ? '+' : ''}{weightGainVal.toFixed(2)} kg
                    </div>
                  )}
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

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowWeightModal(false)}>Cancel</Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>Record Weight</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {showVaccineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Log Vaccination</CardTitle>
                  <CardDescription>Record a vaccination entry for a goat</CardDescription>
                </div>
                <button onClick={() => setShowVaccineModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVaccineSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="vaccineGoatSearch">Search Goat (Ear Tag)</Label>
                  <GoatSearchDropdown
                    refEl={vaccineRef}
                    searchVal={vaccineSearch}
                    setSearch={setVaccineSearch}
                    showDropdown={showVaccineDropdown}
                    setShowDropdown={setShowVaccineDropdown}
                    formGoatId={vaccineForm.goatId}
                    setFormGoatId={(id, tag) => { setVaccineForm({ ...vaccineForm, goatId: id }); setVaccineSearch(tag); }}
                    placeholder="Type ear tag number..."
                    id="vaccineGoatSearch"
                    goatsList={pendingVaccinationGoats}
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
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowVaccineModal(false)}>Cancel</Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>Log Vaccination</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {showDewormingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Log Deworming</CardTitle>
                  <CardDescription>Record a deworming entry for a goat</CardDescription>
                </div>
                <button onClick={() => setShowDewormingModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDewormingSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="dewormingGoatSearch">Search Goat (Ear Tag)</Label>
                  <GoatSearchDropdown
                    refEl={dewormingRef}
                    searchVal={dewormingSearch}
                    setSearch={setDewormingSearch}
                    showDropdown={showDewormingDropdown}
                    setShowDropdown={setShowDewormingDropdown}
                    formGoatId={dewormingForm.goatId}
                    setFormGoatId={(id, tag) => { setDewormingForm({ ...dewormingForm, goatId: id }); setDewormingSearch(tag); }}
                    placeholder="Type ear tag number..."
                    id="dewormingGoatSearch"
                    goatsList={pendingDewormingGoats}
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
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowDewormingModal(false)}>Cancel</Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>Log Deworming</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {showSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-md bg-card shadow-2xl my-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Sell Goat</CardTitle>
                  <CardDescription>Record sale details and calculate profit</CardDescription>
                </div>
                <button onClick={() => setShowSaleModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="saleGoatSearch">Search Goat (Ear Tag)</Label>
                  <GoatSearchDropdown
                    refEl={saleRef}
                    searchVal={saleGoatSearch}
                    setSearch={setSaleGoatSearch}
                    showDropdown={showSaleGoatDropdown}
                    setShowDropdown={setShowSaleGoatDropdown}
                    formGoatId={saleForm.goatId}
                    setFormGoatId={(id, tag) => { setSaleForm({ ...saleForm, goatId: id }); setSaleGoatSearch(tag); }}
                    placeholder="Type ear tag number..."
                    id="saleGoatSearch"
                    goatsList={goatsList}
                  />
                </div>

                <div>
                  <Label htmlFor="saleWeight">Sale Weight (kg)</Label>
                  <Input
                    id="saleWeight"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={saleForm.saleWeight}
                    onChange={(e) => handleSaleWeightChange(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="saleTotalPrice">Total Price (₹)</Label>
                    <Input
                      id="saleTotalPrice"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={saleForm.saleTotalPrice}
                      onChange={(e) => handleSaleTotalPriceChange(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="saleRatePerKg">Price per KG (₹)</Label>
                    <Input
                      id="saleRatePerKg"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={saleForm.saleRatePerKg}
                      onChange={(e) => handleSaleRatePerKgChange(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">Enter either Total Price or Price/KG — the other will auto-calculate.</p>



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

                {/* Live profit summary */}
                <div className="rounded-xl bg-muted/60 border border-border p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Purchase Price:</span>
                    <span className="font-semibold">₹{purchasePrice.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sale Amount:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">₹{computedSaleAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed pt-2 mt-1">
                    <span className="text-muted-foreground font-medium">Net Profit:</span>
                    <span className={`font-bold text-base ${computedNetProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      ₹{computedNetProfit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowSaleModal(false)}>Cancel</Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>Record Sale</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
