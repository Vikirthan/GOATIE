import { describe, expect, it } from 'vitest';
import {
  buildDewormRow,
  buildGoatRow,
  buildVaccRow,
  buildWeightRow,
  fmtDate,
  type ReconRow,
} from '@/utils/reconRows';
import type { Goat } from '@/types';

const baseGoat: Goat = {
  id: 'g1',
  earTagNumber: '88',
  farmerId: 'herd-1',
  purchaseDate: new Date('2026-01-05'),
  purchaseWeight: 12.5,
  variant: 'SEMMARI',
  gender: 'male',
  purchasePrice: 5000,
  sellerName: 'Seller',
  status: 'active',
  createdAt: new Date('2026-01-05'),
  updatedAt: new Date('2026-01-06'),
};

describe('fmtDate', () => {
  it('formats Dates as YYYY-MM-DD', () => {
    expect(fmtDate(new Date('2026-09-25T15:30:00.000Z'))).toBe('2026-09-25');
  });

  it('passes through day-precision strings and empties', () => {
    expect(fmtDate('2026-09-25')).toBe('2026-09-25');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate('not-a-date')).toBe('');
  });
});

describe('buildGoatRow', () => {
  it('maps herd fields and derives vaccination/deworming labels', () => {
    const row = buildGoatRow(baseGoat, undefined, true, false);
    expect(row).toMatchObject({
      id: 'g1',
      earTagNumber: '88',
      purchaseDate: '2026-01-05',
      vaccination: 'Vaccinated',
      deworming: 'Not done',
      status: 'active',
    });
  });

  it('merges sale fields when a sale is present', () => {
    const row = buildGoatRow(
      baseGoat,
      { saleWeight: 20, saleRatePerKg: 300, saleAmount: 6000, netProfit: 1000 } as never,
      false,
      false,
    );
    expect(row).toMatchObject({ saleWeight: 20, saleAmount: 6000, netProfit: 1000 });
  });

  it('blanks sale fields without a sale', () => {
    const row = buildGoatRow(baseGoat, undefined, false, false);
    expect(row.saleWeight).toBe('');
  });
});

describe('child row builders', () => {
  it('buildWeightRow formats dates and gains', () => {
    const row = buildWeightRow(
      {
        id: 'w1', goatId: 'g1', weightNumber: 1, weight: 15,
        dueDate: new Date('2026-02-05'), recordedDate: new Date('2026-02-04'),
        weightGain: 2.5, remarks: 'ok', isRecorded: true,
        createdAt: new Date(), updatedAt: new Date(),
      },
      '88',
    );
    expect(row).toMatchObject({ id: 'w1', earTagNumber: '88', weight: 15, weightGain: 2.5, recordedDate: '2026-02-04' });
  });

  it('buildDewormRow and buildVaccRow carry ear tags through', () => {
    const d: ReconRow = buildDewormRow(
      { id: 'd1', goatId: 'g1', dewormingDate: new Date('2026-03-01'), status: 'dewormed', createdAt: new Date(), updatedAt: new Date() },
      '88',
    );
    const v: ReconRow = buildVaccRow(
      { id: 'v1', goatId: 'g1', vaccinationDate: new Date('2026-03-02'), status: 'vaccinated', createdAt: new Date(), updatedAt: new Date() },
      '88',
    );
    expect(d.earTagNumber).toBe('88');
    expect(v.earTagNumber).toBe('88');
  });
});
