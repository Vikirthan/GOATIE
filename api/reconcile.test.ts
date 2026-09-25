// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeReconOps, currentMonthKey, isFullRewriteRun } from './_lib/reconcile';

afterEach(() => vi.unstubAllEnvs());

describe('computeReconOps', () => {
  it('returns empty ops for empty inputs', () => {
    expect(computeReconOps([], [])).toEqual({ toAdd: [], toUpdate: [], toDeleteIds: [] });
  });

  it('detects adds, updates, and deletes by id', () => {
    const current = [
      { id: 'keep', v: 'same' },
      { id: 'chg', v: 'new' },
      { id: 'new', v: '1' },
    ];
    const existing = [
      { id: 'keep', v: 'same' },
      { id: 'chg', v: 'old' },
      { id: 'gone', v: 'x' },
    ];
    const ops = computeReconOps(current, existing);
    expect(ops.toAdd).toEqual([{ id: 'new', v: '1' }]);
    expect(ops.toUpdate).toEqual([{ id: 'chg', v: 'new' }]);
    expect(ops.toDeleteIds).toEqual(['gone']);
  });

  it('ignores the id column when comparing', () => {
    const ops = computeReconOps([{ id: 'a', v: '1' }], [{ id: 'b', v: '1' }]);
    // Different ids → one add + one delete, no update.
    expect(ops.toAdd).toHaveLength(1);
    expect(ops.toDeleteIds).toHaveLength(1);
    expect(ops.toUpdate).toHaveLength(0);
  });

  it('normalizes dates: ISO strings equal day strings', () => {
    const ops = computeReconOps(
      [{ id: 'r', purchaseDate: '2026-09-01' }],
      [{ id: 'r', purchaseDate: '2026-09-01T00:00:00.000Z' }],
    );
    expect(ops.toUpdate).toHaveLength(0);
  });

  it('normalizes numbers vs numeric strings and trims whitespace', () => {
    const ops = computeReconOps(
      [{ id: 'r', weight: 15, name: '  RKT ' }],
      [{ id: 'r', weight: '15', name: 'RKT' }],
    );
    expect(ops.toUpdate).toHaveLength(0);
  });

  it('treats null/undefined/empty as equal', () => {
    const ops = computeReconOps(
      [{ id: 'r', notes: '' }],
      [{ id: 'r', notes: null }],
    );
    expect(ops.toUpdate).toHaveLength(0);
  });

  it('flags genuinely different values', () => {
    const ops = computeReconOps(
      [{ id: 'r', weight: 15 }],
      [{ id: 'r', weight: 16 }],
    );
    expect(ops.toUpdate).toHaveLength(1);
  });
});

describe('currentMonthKey', () => {
  it('formats YYYY-MM with zero padding', () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe('2026-01');
    expect(currentMonthKey(new Date(2026, 8, 1))).toBe('2026-09');
  });
});

describe('isFullRewriteRun', () => {
  it('is true on the 1st of the month', () => {
    expect(isFullRewriteRun(new Date(2026, 8, 1))).toBe(true);
    expect(isFullRewriteRun(new Date(2026, 8, 15))).toBe(false);
  });

  it('FORCE_FULL_REWRITE=1 forces a rewrite on any day', () => {
    vi.stubEnv('FORCE_FULL_REWRITE', '1');
    expect(isFullRewriteRun(new Date(2026, 8, 15))).toBe(true);
  });
});
