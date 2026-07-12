import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Tag, Calendar, Weight, Syringe, Bug, ShoppingCart, CheckCircle, XCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import {
  getGoat,
  getGoatWeights,
  getAllVaccinationsForGoat,
  getAllDewormingForGoat,
} from '@/services/firebaseService';
import { Goat, WeightRecord, PPRVaccinationRecord, DewormingRecord } from '@/types';

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    sold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    deceased: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${styles[status] || styles.deceased}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

const InfoCard: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string }> = ({
  icon, label, value, accent = 'from-slate-500/10 to-slate-500/5'
}) => (
  <div className={`rounded-xl bg-gradient-to-br ${accent} border border-white/10 dark:border-white/5 p-4 backdrop-blur-sm`}>
    <div className="flex items-center gap-2 mb-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-base font-semibold text-foreground mt-1">{value}</div>
  </div>
);

const StatusRow: React.FC<{
  date?: Date | string;
  label: string;
}> = ({ date, label }) => {
  const done = !!date;
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${done
      ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/40'
      : 'bg-muted/40 border-border'
    }`}>
      <div className="flex items-center gap-2.5">
        {done
          ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
          : <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
        }
        <span className={`text-sm font-medium ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
          {label}
        </span>
      </div>
      <span className={`text-sm font-semibold ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
        {done ? formatDate(date) : 'Not done'}
      </span>
    </div>
  );
};

export const GoatDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [goat, setGoat] = useState<Goat | null>(null);
  const [weights, setWeights] = useState<WeightRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<PPRVaccinationRecord[]>([]);
  const [deworming, setDeworming] = useState<DewormingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const [goatData, weightData, vaccData, dewormData] = await Promise.all([
          getGoat(id),
          getGoatWeights(id),
          getAllVaccinationsForGoat(id),
          getAllDewormingForGoat(id),
        ]);
        if (!goatData) {
          showToast('error', 'Goat not found');
          navigate('/goats');
          return;
        }
        setGoat(goatData);
        setWeights(weightData);
        setVaccinations(vaccData);
        setDeworming(dewormData);
      } catch (err) {
        showToast('error', 'Failed to load goat details');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <LoadingSpinner message="Loading goat details..." />;
  if (!goat) return null;

  const recordedWeights = weights.filter((w) => w.isRecorded && w.weight > 0).sort((a, b) => {
    const timeA = new Date(a.recordedDate || a.createdAt).getTime();
    const timeB = new Date(b.recordedDate || b.createdAt).getTime();
    return timeA - timeB;
  });
  const lastWeight = recordedWeights[recordedWeights.length - 1];
  const lastWeightDate = lastWeight?.recordedDate;

  // Weight gain vs purchase weight
  const totalGain = lastWeight && lastWeight.weightNumber > 0
    ? (lastWeight.weight - goat.purchaseWeight).toFixed(2)
    : null;

  const getWeightForNumber = (num: number) => recordedWeights.find((w) => w.weightNumber === num);
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/goats')}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">
              {goat.status === 'sold' ? 'Sold' : goat.earTagNumber}
            </h1>
            <StatusBadge status={goat.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{goat.variant} · {goat.gender === 'male' ? '♂ Male' : '♀ Female'}</p>
        </div>
      </div>

      {/* Key Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCard
          icon={<Calendar className="h-4 w-4" />}
          label="Purchase Date"
          value={formatDate(goat.purchaseDate)}
          accent="from-blue-500/10 to-blue-500/5"
        />
        <InfoCard
          icon={<Tag className="h-4 w-4" />}
          label="Purchase Price"
          value={`₹${goat.purchasePrice.toLocaleString('en-IN')}`}
          accent="from-violet-500/10 to-violet-500/5"
        />
        <InfoCard
          icon={<Weight className="h-4 w-4" />}
          label="Purchase Weight"
          value={`${goat.purchaseWeight} kg`}
          accent="from-cyan-500/10 to-cyan-500/5"
        />
        <InfoCard
          icon={<Weight className="h-4 w-4" />}
          label="Last Weight"
          value={lastWeight ? `${lastWeight.weight} kg` : 'N/A'}
          accent="from-emerald-500/10 to-emerald-500/5"
        />
      </div>

      {/* Last Weight Date + Gain Row */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCard
          icon={<Calendar className="h-4 w-4" />}
          label="Last Weight Date"
          value={lastWeightDate ? formatDate(lastWeightDate) : 'N/A'}
          accent="from-orange-500/10 to-orange-500/5"
        />
        <div className={`rounded-xl bg-gradient-to-br border p-4 backdrop-blur-sm ${
          totalGain !== null && parseFloat(totalGain) >= 0
            ? 'from-emerald-500/10 to-emerald-500/5 border-emerald-200/30 dark:border-emerald-700/30'
            : 'from-red-500/10 to-red-500/5 border-red-200/30 dark:border-red-700/30'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            {totalGain !== null && parseFloat(totalGain) >= 0
              ? <TrendingUp className="h-4 w-4 text-emerald-500" />
              : <TrendingDown className="h-4 w-4 text-red-500" />
            }
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Weight Gain</span>
          </div>
          <div className={`text-base font-semibold mt-1 ${
            totalGain !== null && parseFloat(totalGain) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
          }`}>
            {totalGain !== null ? `${parseFloat(totalGain) >= 0 ? '+' : ''}${totalGain} kg` : 'N/A'}
          </div>
        </div>
      </div>

      {/* Current Status Info */}
      {goat.status === 'sold' && goat.saleInfo && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-semibold text-amber-700 dark:text-amber-300">Sale Details</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Sale Date</span>
              <span className="font-semibold">{formatDate(goat.saleInfo.saleDate)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Sale Weight</span>
              <span className="font-semibold">{goat.saleInfo.saleWeight} kg</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Rate/kg</span>
              <span className="font-semibold">₹{goat.saleInfo.saleRatePerKg.toLocaleString('en-IN')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Sale Amount</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">₹{goat.saleInfo.saleAmount.toLocaleString('en-IN')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Net Profit</span>
              <span className={`font-semibold ${goat.saleInfo.netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                ₹{goat.saleInfo.netProfit.toLocaleString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs mb-0.5">Buyer</span>
              <span className="font-semibold">{goat.saleInfo.buyerName}</span>
            </div>
          </div>
        </div>
      )}

      {/* Weight History */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Weight className="h-5 w-5 text-cyan-500" />
          <h2 className="font-semibold text-foreground">Weight History</h2>
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((num) => {
            const w = num === 0
              ? { weight: goat.purchaseWeight, recordedDate: goat.purchaseDate, weightGain: undefined }
              : getWeightForNumber(num);
            const label = num === 0 ? 'Purchase Weight' : `Weight ${num}`;
            const gain = w && num > 0 ? (w as WeightRecord).weightGain : undefined;
            return (
              <div key={num} className={`flex items-center justify-between p-3 rounded-lg border ${
                w ? 'bg-cyan-50 border-cyan-200 dark:bg-cyan-900/20 dark:border-cyan-700/40'
                  : 'bg-muted/40 border-border'
              }`}>
                <div className="flex items-center gap-2.5">
                  {w
                    ? <CheckCircle className="h-4 w-4 text-cyan-500 shrink-0" />
                    : <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <span className={`text-sm font-medium ${w ? 'text-cyan-700 dark:text-cyan-300' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {gain !== undefined && gain !== null && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      gain >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'
                    }`}>
                      {gain >= 0 ? '+' : ''}{gain} kg
                    </span>
                  )}
                  <span className={`text-sm font-semibold ${w ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'}`}>
                    {w ? `${(w as any).weight} kg` : 'N/A'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vaccination Status */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Syringe className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-foreground">Vaccination Status</h2>
        </div>
        <div className="space-y-2">
          <StatusRow
            date={vaccinations.length > 0 ? vaccinations[vaccinations.length - 1].vaccinationDate : undefined}
            label="Vaccination"
          />
        </div>
      </div>

      {/* Deworming Status */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Bug className="h-5 w-5 text-orange-500" />
          <h2 className="font-semibold text-foreground">Deworming Status</h2>
        </div>
        <div className="space-y-2">
          <StatusRow
            date={deworming.length > 0 ? deworming[deworming.length - 1].dewormingDate : undefined}
            label="Deworming"
          />
        </div>
      </div>

      {/* Notes */}
      {goat.notes && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{goat.notes}</p>
        </div>
      )}
    </div>
  );
};
