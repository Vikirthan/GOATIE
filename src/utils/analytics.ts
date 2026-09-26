import type {
  DewormingRecord,
  Goat,
  PPRVaccinationRecord,
  WeightRecord,
} from '@/types';

export interface AnalyticsFilters {
  from?: Date | null;
  to?: Date | null;
  variant?: string;
  gender?: '' | 'male' | 'female';
}

export const toDate = (v: Date | string | undefined | null): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return isNaN(n) ? fallback : n;
};

export function filterGoats(goats: Goat[], f: AnalyticsFilters): Goat[] {
  const from = f.from ? new Date(f.from) : null;
  const to = f.to ? new Date(f.to) : null;
  if (to) to.setHours(23, 59, 59, 999);
  return goats.filter((g) => {
    if (f.gender && g.gender !== f.gender) return false;
    if (f.variant && (g.variant || '').toLowerCase() !== f.variant.toLowerCase()) return false;
    if (from || to) {
      const purchase = toDate(g.purchaseDate);
      const sale = g.saleInfo ? toDate(g.saleInfo.saleDate) : null;
      const inRange = (d: Date | null) => {
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      };
      if (!inRange(purchase) && !inRange(sale)) return false;
    }
    return true;
  });
}

export function distinctVariants(goats: Goat[]): string[] {
  const set = new Set<string>();
  goats.forEach((g) => {
    const v = (g.variant || '').trim();
    if (v) set.add(v);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

const monthLabel = (d: Date) =>
  d.toLocaleString('en-IN', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2);

function lastNMonths(n: number, now = new Date()) {
  const out: { key: string; label: string; year: number; month: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    out.push({ key, label: monthLabel(d), year: d.getFullYear(), month: d.getMonth() });
  }
  return out;
}

// ─── Weights ────────────────────────────────────────────────────────────────

export function lastWeightForGoat(goat: Goat, weights: WeightRecord[]): number {
  const recs = weights
    .filter((w) => w.goatId === goat.id && w.isRecorded && num(w.weight) > 0)
    .sort((a, b) => {
      const ta = toDate(a.recordedDate || a.createdAt)?.getTime() ?? 0;
      const tb = toDate(b.recordedDate || b.createdAt)?.getTime() ?? 0;
      return tb - ta;
    });
  if (recs.length > 0) return num(recs[0].weight);
  return num(goat.purchaseWeight);
}

export function daysOnFarm(goat: Goat, now = new Date()): number {
  const start = toDate(goat.purchaseDate);
  if (!start) return 0;
  const end = goat.status === 'sold' && goat.saleInfo ? toDate(goat.saleInfo.saleDate) ?? now : now;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

// ─── Financials ─────────────────────────────────────────────────────────────

export interface MonthlyMoney {
  key: string;
  label: string;
  revenue: number;
  profit: number;
  count: number;
  avgRate: number;
}

export interface VariantMoney {
  variant: string;
  revenue: number;
  profit: number;
  count: number;
  avgProfit: number;
}

export interface BuyerRow {
  buyer: string;
  count: number;
  revenue: number;
  avgRate: number;
}

export interface FinancialSummary {
  soldCount: number;
  totalInvestment: number;
  totalRevenue: number;
  totalProfit: number;
  avgProfit: number;
  avgProfitPct: number;
  roi: number;
  totalPurchaseCostSold: number;
  totalDeductions: number;
  commission: number;
  transport: number;
  other: number;
  avgRatePerKg: number;
  inventoryPurchaseValue: number;
  inventoryProjectedValue: number;
  monthly: MonthlyMoney[];
  byVariant: VariantMoney[];
  byGender: { gender: string; revenue: number; profit: number; count: number }[];
  rateTrend: { key: string; label: string; avgRate: number; count: number }[];
  topBuyers: BuyerRow[];
}

export function computeFinancials(
  goats: Goat[],
  weights: WeightRecord[] = [],
  now = new Date(),
): FinancialSummary {
  const sold = goats.filter((g) => g.status === 'sold' && g.saleInfo);
  const active = goats.filter((g) => g.status === 'active');

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalPurchaseCostSold = 0;
  let commission = 0;
  let transport = 0;
  let other = 0;
  let rateSum = 0;
  let rateCount = 0;
  let profitPctSum = 0;

  const buyerMap = new Map<string, { count: number; revenue: number; rateSum: number }>();
  const variantMap = new Map<string, { revenue: number; profit: number; count: number }>();
  const genderMap = new Map<string, { revenue: number; profit: number; count: number }>();

  for (const g of sold) {
    const s = g.saleInfo!;
    const rev = num(s.saleAmount, num(s.saleWeight) * num(s.saleRatePerKg));
    const profit = num(s.netProfit, rev - num(g.purchasePrice) - num(s.commission) - num(s.transportCharges) - num(s.otherCharges));
    totalRevenue += rev;
    totalProfit += profit;
    totalPurchaseCostSold += num(g.purchasePrice);
    commission += num(s.commission);
    transport += num(s.transportCharges);
    other += num(s.otherCharges);
    if (num(s.saleRatePerKg) > 0) {
      rateSum += num(s.saleRatePerKg);
      rateCount += 1;
    }
    profitPctSum += num(s.profitPercentage, num(g.purchasePrice) > 0 ? (profit / num(g.purchasePrice)) * 100 : 0);

    const vKey = (g.variant || 'Unknown').trim() || 'Unknown';
    const ve = variantMap.get(vKey) ?? { revenue: 0, profit: 0, count: 0 };
    ve.revenue += rev;
    ve.profit += profit;
    ve.count += 1;
    variantMap.set(vKey, ve);

    const ge = genderMap.get(g.gender) ?? { revenue: 0, profit: 0, count: 0 };
    ge.revenue += rev;
    ge.profit += profit;
    ge.count += 1;
    genderMap.set(g.gender, ge);

    const buyer = (s.buyerName || 'Unknown').trim() || 'Unknown';
    const be = buyerMap.get(buyer) ?? { count: 0, revenue: 0, rateSum: 0 };
    be.count += 1;
    be.revenue += rev;
    be.rateSum += num(s.saleRatePerKg);
    buyerMap.set(buyer, be);
  }

  const months = lastNMonths(8, now);
  const monthly: MonthlyMoney[] = months.map((m) => ({ key: m.key, label: m.label, revenue: 0, profit: 0, count: 0, avgRate: 0 }));
  const rateTrend = months.map((m) => ({ key: m.key, label: m.label, avgRate: 0, count: 0 }));
  const rateAcc = new Map<string, { sum: number; count: number }>();
  for (const g of sold) {
    const sd = toDate(g.saleInfo!.saleDate);
    if (!sd) continue;
    const key = `${sd.getFullYear()}-${sd.getMonth()}`;
    const row = monthly.find((r) => r.key === key);
    const rt = rateTrend.find((r) => r.key === key);
    const acc = rateAcc.get(key) ?? { sum: 0, count: 0 };
    const rev = num(g.saleInfo!.saleAmount, num(g.saleInfo!.saleWeight) * num(g.saleInfo!.saleRatePerKg));
    const profit = num(g.saleInfo!.netProfit);
    if (row) {
      row.revenue += rev;
      row.profit += profit;
      row.count += 1;
    }
    if (rt && num(g.saleInfo!.saleRatePerKg) > 0) {
      acc.sum += num(g.saleInfo!.saleRatePerKg);
      acc.count += 1;
      rateAcc.set(key, acc);
    }
  }
  for (const rt of rateTrend) {
    const acc = rateAcc.get(rt.key);
    rt.avgRate = acc && acc.count > 0 ? Math.round((acc.sum / acc.count) * 100) / 100 : 0;
  }
  for (const m of monthly) {
    const acc = rateAcc.get(m.key);
    m.avgRate = acc && acc.count > 0 ? Math.round((acc.sum / acc.count) * 100) / 100 : 0;
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.profit = Math.round(m.profit * 100) / 100;
  }

  const recentRates = rateTrend.filter((r) => r.avgRate > 0).slice(-3);
  const currentAvgRate =
    recentRates.length > 0 ? recentRates.reduce((a, r) => a + r.avgRate, 0) / recentRates.length : rateCount > 0 ? rateSum / rateCount : 0;

  let inventoryPurchaseValue = 0;
  let inventoryProjectedValue = 0;
  for (const g of active) {
    inventoryPurchaseValue += num(g.purchasePrice);
    inventoryProjectedValue += lastWeightForGoat(g, weights) * currentAvgRate;
  }

  const byVariant: VariantMoney[] = [...variantMap.entries()]
    .map(([variant, v]) => ({ variant, ...v, avgProfit: v.count > 0 ? v.profit / v.count : 0 }))
    .sort((a, b) => b.profit - a.profit);

  const topBuyers: BuyerRow[] = [...buyerMap.entries()]
    .map(([buyer, v]) => ({ buyer, count: v.count, revenue: v.revenue, avgRate: v.count > 0 ? Math.round((v.rateSum / v.count) * 100) / 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const soldCount = sold.length;
  const totalInvestment = goats.reduce((sum, g) => sum + num(g.purchasePrice), 0);
  return {
    soldCount,
    totalInvestment: Math.round(totalInvestment * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    avgProfit: soldCount > 0 ? Math.round((totalProfit / soldCount) * 100) / 100 : 0,
    avgProfitPct: soldCount > 0 ? Math.round((profitPctSum / soldCount) * 100) / 100 : 0,
    roi: totalPurchaseCostSold > 0 ? Math.round((totalProfit / totalPurchaseCostSold) * 10000) / 100 : 0,
    totalPurchaseCostSold: Math.round(totalPurchaseCostSold * 100) / 100,
    totalDeductions: Math.round((commission + transport + other) * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    transport: Math.round(transport * 100) / 100,
    other: Math.round(other * 100) / 100,
    avgRatePerKg: rateCount > 0 ? Math.round((rateSum / rateCount) * 100) / 100 : 0,
    inventoryPurchaseValue: Math.round(inventoryPurchaseValue * 100) / 100,
    inventoryProjectedValue: Math.round(inventoryProjectedValue * 100) / 100,
    monthly,
    byVariant,
    byGender: [...genderMap.entries()].map(([gender, v]) => ({ gender, ...v })),
    rateTrend,
    topBuyers,
  };
}

// ─── Growth ─────────────────────────────────────────────────────────────────

export interface GrowthRow {
  goatId: string;
  earTag: string;
  variant: string;
  gender: string;
  status: Goat['status'];
  purchaseWeight: number;
  lastWeight: number;
  gain: number;
  gainPct: number;
  daysOnFarm: number;
  adg: number;
  weeklyGain: number;
  monthlyGain: number;
}

export interface GrowthSummary {
  rows: GrowthRow[];
  herdAvgAdg: number;
  herdAvgWeeklyGain: number;
  herdAvgGain: number;
  herdAvgGainPct: number;
  growthCurve: { stage: string; label: string; avgWeight: number; count: number }[];
  variantCompare: { variant: string; avgWeeklyGain: number; avgGain: number; count: number }[];
  genderCompare: { gender: string; avgWeeklyGain: number; avgGain: number; count: number }[];
  topGrowers: GrowthRow[];
  slowGrowers: GrowthRow[];
  stunted: GrowthRow[];
  gainBuckets: { bucket: string; count: number }[];
  avgHoldingDays: number;
}

export function computeGrowth(goats: Goat[], weights: WeightRecord[], now = new Date()): GrowthSummary {
  const rows: GrowthRow[] = goats.map((g) => {
    const last = lastWeightForGoat(g, weights);
    const purchase = num(g.purchaseWeight);
    const gain = last - purchase;
    const gainPct = purchase > 0 ? (gain / purchase) * 100 : 0;
    const days = daysOnFarm(g, now);
    const adg = days > 0 ? gain / days : 0;
    return {
      goatId: g.id,
      earTag: g.earTagNumber,
      variant: g.variant || 'Unknown',
      gender: g.gender,
      status: g.status,
      purchaseWeight: purchase,
      lastWeight: Math.round(last * 100) / 100,
      gain: Math.round(gain * 100) / 100,
      gainPct: Math.round(gainPct * 100) / 100,
      daysOnFarm: days,
      adg: Math.round(adg * 1000) / 1000,
      weeklyGain: Math.round(adg * 7 * 1000) / 1000,
      monthlyGain: Math.round(adg * 30 * 100) / 100,
    };
  });

  const withDays = rows.filter((r) => r.daysOnFarm > 0);
  const herdAvgAdg = withDays.length > 0 ? withDays.reduce((a, r) => a + r.adg, 0) / withDays.length : 0;
  const herdAvgWeeklyGain = withDays.length > 0 ? withDays.reduce((a, r) => a + r.weeklyGain, 0) / withDays.length : 0;
  const herdAvgGain = rows.length > 0 ? rows.reduce((a, r) => a + r.gain, 0) / rows.length : 0;
  const herdAvgGainPct = rows.length > 0 ? rows.reduce((a, r) => a + r.gainPct, 0) / rows.length : 0;

  const stages = [
    { stage: '0', label: 'Purchase' },
    { stage: '1', label: 'W1' },
    { stage: '2', label: 'W2' },
    { stage: '3', label: 'W3' },
    { stage: '4', label: 'W4' },
  ];
  const growthCurve = stages.map((s) => {
    const vals = weights.filter((w) => String(w.weightNumber) === s.stage && w.isRecorded && num(w.weight) > 0).map((w) => num(w.weight));
    const purchaseVals = s.stage === '0' ? goats.map((g) => num(g.purchaseWeight)).filter((v) => v > 0) : vals;
    const arr = s.stage === '0' ? purchaseVals : vals;
    return {
      stage: s.stage,
      label: s.label,
      avgWeight: arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0,
      count: arr.length,
    };
  });
  const saleWeights = goats.filter((g) => g.status === 'sold' && g.saleInfo).map((g) => num(g.saleInfo!.saleWeight)).filter((v) => v > 0);
  growthCurve.push({
    stage: 'sale',
    label: 'Sale',
    avgWeight: saleWeights.length > 0 ? Math.round((saleWeights.reduce((a, b) => a + b, 0) / saleWeights.length) * 100) / 100 : 0,
    count: saleWeights.length,
  });

  const byVariant = new Map<string, GrowthRow[]>();
  const byGender = new Map<string, GrowthRow[]>();
  for (const r of rows) {
    const v = (r.variant || 'Unknown').trim() || 'Unknown';
    if (!byVariant.has(v)) byVariant.set(v, []);
    byVariant.get(v)!.push(r);
    if (!byGender.has(r.gender)) byGender.set(r.gender, []);
    byGender.get(r.gender)!.push(r);
  }
  const avg = (arr: GrowthRow[], k: 'adg' | 'gain') => (arr.length > 0 ? arr.reduce((a, r) => a + r[k], 0) / arr.length : 0);
  const variantCompare = [...byVariant.entries()].map(([variant, arr]) => ({
    variant,
    avgWeeklyGain: Math.round(avg(arr, 'adg') * 7 * 1000) / 1000,
    avgGain: Math.round(avg(arr, 'gain') * 100) / 100,
    count: arr.length,
  }));
  const genderCompare = [...byGender.entries()].map(([gender, arr]) => ({
    gender,
    avgWeeklyGain: Math.round(avg(arr, 'adg') * 7 * 1000) / 1000,
    avgGain: Math.round(avg(arr, 'gain') * 100) / 100,
    count: arr.length,
  }));

  const sorted = [...rows].sort((a, b) => b.adg - a.adg);
  const topGrowers = sorted.slice(0, 5);
  const slowGrowers = [...rows].sort((a, b) => a.adg - b.adg).slice(0, 5);
  const stunted = rows.filter((r) => r.status === 'active' && r.daysOnFarm >= 30 && r.monthlyGain < 1.5);

  const buckets = [
    { bucket: '< 0 kg/mo', test: (m: number) => m < 0 },
    { bucket: '0–1.5 kg/mo', test: (m: number) => m >= 0 && m < 1.5 },
    { bucket: '1.5–3 kg/mo', test: (m: number) => m >= 1.5 && m < 3 },
    { bucket: '3+ kg/mo', test: (m: number) => m >= 3 },
  ];
  const gainBuckets = buckets.map((b) => ({ bucket: b.bucket, count: rows.filter((r) => b.test(r.monthlyGain)).length }));

  const soldRows = rows.filter((r) => goats.find((g) => g.id === r.goatId)?.status === 'sold');
  const avgHoldingDays = soldRows.length > 0 ? Math.round(soldRows.reduce((a, r) => a + r.daysOnFarm, 0) / soldRows.length) : 0;

  return {
    rows,
    herdAvgAdg: Math.round(herdAvgAdg * 1000) / 1000,
    herdAvgWeeklyGain: Math.round(herdAvgWeeklyGain * 1000) / 1000,
    herdAvgGain: Math.round(herdAvgGain * 100) / 100,
    herdAvgGainPct: Math.round(herdAvgGainPct * 100) / 100,
    growthCurve,
    variantCompare,
    genderCompare,
    topGrowers,
    slowGrowers,
    stunted,
    gainBuckets,
    avgHoldingDays,
  };
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface HealthSummary {
  total: number;
  active: number;
  dewormCoverage: number;
  vaccCoverage: number;
  weightCompliance: number;
  weightDue: number;
  weightOverdue: number;
  pendingDeworm: number;
  pendingVacc: number;
  mortalityRate: number;
  deathLoss: number;
  deadCount: number;
  overdueBuckets: { bucket: string; count: number; earTags: string[] }[];
  vaccAdg: number;
  pendingAdg: number;
  vaccWeeklyGain: number;
  pendingWeeklyGain: number;
}

export function computeHealth(
  goats: Goat[],
  weights: WeightRecord[],
  dewormings: DewormingRecord[],
  vaccinations: PPRVaccinationRecord[],
  growthRows: GrowthRow[] = [],
  now = new Date(),
): HealthSummary {
  const total = goats.length;
  const active = goats.filter((g) => g.status === 'active');
  const dead = goats.filter((g) => g.status === 'deceased');

  const dewormedIds = new Set(dewormings.map((d) => d.goatId));
  const vaccIds = new Set(vaccinations.map((v) => v.goatId));
  const activeIds = new Set(active.map((g) => g.id));
  const dewormedActive = [...dewormedIds].filter((id) => activeIds.has(id)).length;
  const vaccActive = [...vaccIds].filter((id) => activeIds.has(id)).length;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dueWeights = weights.filter((w) => {
    const due = toDate(w.dueDate);
    return due && due <= today;
  });
  const recordedDue = dueWeights.filter((w) => w.isRecorded).length;
  const unrecordedDue = dueWeights.filter((w) => !w.isRecorded);
  const overdue = unrecordedDue.filter((w) => {
    const due = toDate(w.dueDate)!;
    return Math.floor((today.getTime() - due.getTime()) / 86400000) > 3;
  });

  const bucket = (days: number) => (days <= 7 ? '0–7 days' : days <= 30 ? '8–30 days' : '30+ days');
  const goatById = new Map(goats.map((g) => [g.id, g]));
  const buckets = ['0–7 days', '8–30 days', '30+ days'].map((b) => ({ bucket: b, count: 0, earTags: [] as string[] }));
  for (const w of overdue) {
    const due = toDate(w.dueDate)!;
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
    const row = buckets.find((x) => x.bucket === bucket(days))!;
    row.count += 1;
    const earTag = goatById.get(w.goatId)?.earTagNumber;
    if (earTag && !row.earTags.includes(earTag)) row.earTags.push(earTag);
  }

  const byId = new Map(growthRows.map((r) => [r.goatId, r.adg]));
  const vaccAdgs = [...vaccIds].map((id) => byId.get(id)).filter((v): v is number => typeof v === 'number');
  const pendingAdgs = active.filter((g) => !vaccIds.has(g.id)).map((g) => byId.get(g.id)).filter((v): v is number => typeof v === 'number');
  const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const vaccAdg = mean(vaccAdgs);
  const pendingAdg = mean(pendingAdgs);

  return {
    total,
    active: active.length,
    dewormCoverage: active.length > 0 ? Math.round((dewormedActive / active.length) * 10000) / 100 : 0,
    vaccCoverage: active.length > 0 ? Math.round((vaccActive / active.length) * 10000) / 100 : 0,
    weightCompliance: dueWeights.length > 0 ? Math.round((recordedDue / dueWeights.length) * 10000) / 100 : 100,
    weightDue: unrecordedDue.length,
    weightOverdue: overdue.length,
    pendingDeworm: active.length - dewormedActive,
    pendingVacc: active.length - vaccActive,
    mortalityRate: total > 0 ? Math.round((dead.length / total) * 10000) / 100 : 0,
    deathLoss: Math.round(dead.reduce((a, g) => a + num(g.purchasePrice), 0) * 100) / 100,
    deadCount: dead.length,
    overdueBuckets: buckets,
    vaccAdg: Math.round(vaccAdg * 1000) / 1000,
    pendingAdg: Math.round(pendingAdg * 1000) / 1000,
    vaccWeeklyGain: Math.round(vaccAdg * 7 * 1000) / 1000,
    pendingWeeklyGain: Math.round(pendingAdg * 7 * 1000) / 1000,
  };
}

// ─── Herd ───────────────────────────────────────────────────────────────────

export interface HerdSummary {
  purchaseTrend: { key: string; label: string; count: number }[];
  sexRatio: { name: string; value: number }[];
  variantMix: { name: string; value: number }[];
  ageStructure: { bucket: string; count: number; earTags: string[] }[];
  dueForecast: { goatId: string; earTag: string; weightNumber: number; dueDate: Date | null; daysUntil: number }[];
}

export function computeHerd(goats: Goat[], weights: WeightRecord[], now = new Date()): HerdSummary {
  const months = lastNMonths(8, now);
  const purchaseTrend = months.map((m) => ({ key: m.key, label: m.label, count: 0 }));
  for (const g of goats) {
    const pd = toDate(g.purchaseDate);
    if (!pd) continue;
    const key = `${pd.getFullYear()}-${pd.getMonth()}`;
    const row = purchaseTrend.find((r) => r.key === key);
    if (row) row.count += 1;
  }

  const males = goats.filter((g) => g.gender === 'male').length;
  const females = goats.filter((g) => g.gender === 'female').length;
  const mix = new Map<string, number>();
  for (const g of goats) {
    const v = (g.variant || 'Unknown').trim() || 'Unknown';
    mix.set(v, (mix.get(v) ?? 0) + 1);
  }

  const buckets = [
    { bucket: '< 90 days', test: (d: number) => d < 90 },
    { bucket: '90–180 days', test: (d: number) => d >= 90 && d <= 180 },
    { bucket: '180+ days', test: (d: number) => d > 180 },
  ];
  const ageStructure = buckets.map((b) => {
    const matchingGoats = goats.filter((g) => g.status === 'active' && b.test(daysOnFarm(g, now)));
    return {
      bucket: b.bucket,
      count: matchingGoats.length,
      earTags: matchingGoats.map((g) => g.earTagNumber).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    };
  });

  const limit = new Date(now);
  limit.setDate(limit.getDate() + 30);
  const goatById = new Map(goats.map((g) => [g.id, g]));
  const dueForecast = weights
    .filter((w) => {
      if (w.isRecorded) return false;
      const due = toDate(w.dueDate);
      if (!due || due < now || due > limit) return false;
      const g = goatById.get(w.goatId);
      return g?.status === 'active';
    })
    .map((w) => {
      const g = goatById.get(w.goatId)!;
      const due = toDate(w.dueDate);
      return {
        goatId: w.goatId,
        earTag: g.earTagNumber,
        weightNumber: num(w.weightNumber),
        dueDate: due,
        daysUntil: due ? Math.ceil((due.getTime() - now.getTime()) / 86400000) : 0,
      };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 20);

  return {
    purchaseTrend,
    sexRatio: [
      { name: 'Male', value: males },
      { name: 'Female', value: females },
    ],
    variantMix: [...mix.entries()].map(([name, value]) => ({ name, value })),
    ageStructure,
    dueForecast,
  };
}

// ─── Ready to sell ──────────────────────────────────────────────────────────

export interface ReadyRow {
  goatId: string;
  earTag: string;
  lastWeight: number;
  adg: number;
  daysOnFarm: number;
  projectedAmount: number;
  projectedProfit: number;
  reason: string;
}

export function computeReadyToSell(
  goats: Goat[],
  weights: WeightRecord[],
  currentAvgRate: number,
  now = new Date(),
): ReadyRow[] {
  const out: ReadyRow[] = [];
  for (const g of goats) {
    if (g.status !== 'active') continue;
    const last = lastWeightForGoat(g, weights);
    const days = daysOnFarm(g, now);
    const adg = days > 0 ? (last - num(g.purchaseWeight)) / days : 0;
    const recordedWeights = weights.filter((w) => w.goatId === g.id && w.isRecorded && num(w.weight) > 0);
    const completedMonthlyWeights = new Set(
      recordedWeights
        .filter((w) => num(w.weightNumber) >= 1 && num(w.weightNumber) <= 4)
        .map((w) => num(w.weightNumber)),
    ).size;
    const hasPostPurchaseWeight = recordedWeights.some((w) => num(w.weightNumber) >= 1);
    const reasons: string[] = [];
    if (completedMonthlyWeights >= 4) reasons.push('W1-W4 weights done');
    if (last >= 25) reasons.push(`${last.toFixed(1)}kg target hit`);
    if (days >= 150) reasons.push(`${days}d on farm`);
    if (hasPostPurchaseWeight && adg < 0.05 && days >= 60) reasons.push('Growth plateaued');
    if (reasons.length === 0) continue;
    const projectedAmount = last * currentAvgRate;
    out.push({
      goatId: g.id,
      earTag: g.earTagNumber,
      lastWeight: Math.round(last * 100) / 100,
      adg: Math.round(adg * 1000) / 1000,
      daysOnFarm: days,
      projectedAmount: Math.round(projectedAmount * 100) / 100,
      projectedProfit: Math.round((projectedAmount - num(g.purchasePrice)) * 100) / 100,
      reason: reasons.join(' · '),
    });
  }
  return out.sort((a, b) => b.projectedProfit - a.projectedProfit).slice(0, 15);
}
