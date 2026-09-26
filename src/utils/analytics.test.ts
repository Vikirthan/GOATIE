import { describe, expect, it } from 'vitest';
import type { Goat, WeightRecord } from '@/types';
import {
  computeFinancials,
  computeGrowth,
  computeHealth,
  computeHerd,
  computeReadyToSell,
  filterGoats,
} from '@/utils/analytics';

const d = (s: string) => new Date(s);

function goat(partial: Partial<Goat> & { id: string }): Goat {
  return {
    earTagNumber: 'T1',
    farmerId: 'f1',
    purchaseDate: d('2026-01-01'),
    purchaseWeight: 15,
    variant: 'Semmari',
    gender: 'male',
    purchasePrice: 5000,
    sellerName: 'S',
    status: 'active',
    createdAt: d('2026-01-01'),
    updatedAt: d('2026-01-01'),
    ...partial,
  } as Goat;
}

describe('analytics engine', () => {
  it('computes investment, revenue, profit, ROI and monthly trend', () => {
    const goats = [
      goat({
        id: 'g1',
        status: 'sold',
        saleInfo: {
          id: 's1',
          goatId: 'g1',
          saleDate: d('2026-08-10'),
          saleWeight: 25,
          saleRatePerKg: 400,
          buyerName: 'Buyer A',
          saleAmount: 10000,
          netProfit: 4500,
          profitPercentage: 90,
          createdAt: d('2026-08-10'),
          updatedAt: d('2026-08-10'),
        },
      }),
      goat({ id: 'g2', variant: 'Velladu', gender: 'female' }),
    ];
    const fin = computeFinancials(goats, [], d('2026-09-25'));
    expect(fin.soldCount).toBe(1);
    expect(fin.totalInvestment).toBe(10000);
    expect(fin.totalRevenue).toBe(10000);
    expect(fin.totalProfit).toBe(4500);
    expect(fin.roi).toBe(90);
    expect(fin.avgRatePerKg).toBe(400);
    expect(fin.byVariant).toHaveLength(1);
    expect(fin.topBuyers[0].buyer).toBe('Buyer A');
    const aug = fin.monthly.find((m) => m.count === 1);
    expect(aug?.revenue).toBe(10000);
  });

  it('filters by variant, gender and date', () => {
    const goats = [
      goat({ id: 'g1', variant: 'Semmari', gender: 'male' }),
      goat({ id: 'g2', variant: 'Velladu', gender: 'female' }),
    ];
    expect(filterGoats(goats, { variant: 'Velladu', gender: '' }).map((g) => g.id)).toEqual(['g2']);
    expect(filterGoats(goats, { variant: '', gender: 'male' }).map((g) => g.id)).toEqual(['g1']);
  });

  it('computes ADG, growth curve and stunted flags', () => {
    const goats = [goat({ id: 'g1', purchaseWeight: 10 })];
    const weights: WeightRecord[] = [
      { id: 'w1', goatId: 'g1', weightNumber: 1, weight: 13, dueDate: d('2026-02-01'), recordedDate: d('2026-02-01'), isRecorded: true, createdAt: d('2026-02-01'), updatedAt: d('2026-02-01') } as WeightRecord,
      { id: 'w2', goatId: 'g1', weightNumber: 2, weight: 16, dueDate: d('2026-03-01'), recordedDate: d('2026-03-01'), isRecorded: true, createdAt: d('2026-03-01'), updatedAt: d('2026-03-01') } as WeightRecord,
    ];
    const growth = computeGrowth(goats, weights, d('2026-04-01'));
    expect(growth.rows[0].lastWeight).toBe(16);
    expect(growth.rows[0].gain).toBe(6);
    expect(growth.rows[0].weeklyGain).toBe(0.467);
    expect(growth.herdAvgWeeklyGain).toBe(0.467);
    expect(growth.growthCurve.find((c) => c.stage === '1')?.avgWeight).toBe(13);
    expect(growth.gainBuckets.reduce((a, b) => a + b.count, 0)).toBe(1);
  });

  it('computes health coverage and mortality', () => {
    const goats = [
      goat({ id: 'g1', status: 'active' }),
      goat({ id: 'g2', status: 'deceased', purchasePrice: 4000 }),
    ];
    const health = computeHealth(
      goats,
      [],
      [{ id: 'x', goatId: 'g1' } as any],
      [{ id: 'y', goatId: 'g1' } as any],
      [],
      d('2026-09-25'),
    );
    expect(health.active).toBe(1);
    expect(health.dewormCoverage).toBe(100);
    expect(health.vaccCoverage).toBe(100);
    expect(health.mortalityRate).toBe(50);
    expect(health.deathLoss).toBe(4000);
  });

  it('includes goat tags in overdue weight buckets', () => {
    const goats = [goat({ id: 'g1', earTagNumber: 'TAG-7' })];
    const weights: WeightRecord[] = [{
      id: 'w1',
      goatId: 'g1',
      weightNumber: 1,
      weight: 0,
      dueDate: d('2026-05-01'),
      isRecorded: false,
      createdAt: d('2026-01-01'),
      updatedAt: d('2026-01-01'),
    } as WeightRecord];
    const health = computeHealth(goats, weights, [], [], [], d('2026-06-01'));
    expect(health.overdueBuckets.find((bucket) => bucket.earTags.length > 0)?.earTags).toEqual(['TAG-7']);
  });

  it('computes herd mix and ready-to-sell', () => {
    const goats = [goat({ id: 'g1', purchaseWeight: 10, purchaseDate: d('2026-01-01') })];
    const weights: WeightRecord[] = [1, 2, 3, 4].map((n) => ({
      id: `w${n}`,
      goatId: 'g1',
      weightNumber: n,
      weight: 20 + n,
      dueDate: d('2026-02-01'),
      recordedDate: d('2026-02-01'),
      isRecorded: true,
      createdAt: d('2026-02-01'),
      updatedAt: d('2026-02-01'),
    }) as WeightRecord);
    const herd = computeHerd(goats, weights, d('2026-03-01'));
    expect(herd.variantMix[0].value).toBe(1);
    expect(herd.ageStructure[0].earTags).toEqual(['T1']);
    const ready = computeReadyToSell(goats, weights, 400, d('2026-03-01'));
    expect(ready).toHaveLength(1);
    expect(ready[0].reason).toBe('W1-W4 weights done');
    expect(ready[0].projectedProfit).toBeGreaterThan(0);
  });

  it('does not infer a plateau without a post-purchase weight', () => {
    const goats = [goat({ id: 'g1', purchaseWeight: 15 })];
    const ready = computeReadyToSell(goats, [], 400, d('2026-03-02'));
    expect(ready).toEqual([]);
  });
});
