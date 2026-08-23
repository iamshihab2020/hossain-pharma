import { describe, expect, it } from 'vitest';
import { dedupeAds, isMigratableObjectId, normaliseRole, toMinorUnits } from './transform.js';

describe('toMinorUnits', () => {
  it('converts a float price to integer minor units', () => {
    expect(toMinorUnits(385.0, 'BDT')).toEqual({ amount: 38500, currency: 'BDT' });
  });

  it('rounds half away from zero deterministically', () => {
    // 12.345 * 100 = 1234.5 -> 1235. Documented so the reconciliation report
    // is explainable rather than surprising.
    expect(toMinorUnits(12.345, 'BDT').amount).toBe(1235);
  });

  it('survives binary float representation error', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754. The legacy server did
    // parseInt(price * 100) and charged 1998. This is the bug being migrated away from.
    expect(toMinorUnits(19.99, 'USD').amount).toBe(1999);
  });

  it('treats a missing price as zero rather than NaN', () => {
    expect(toMinorUnits(undefined, 'BDT').amount).toBe(0);
  });

  it('treats a non-finite price as zero rather than crashing the load', () => {
    expect(toMinorUnits(Number.NaN, 'BDT').amount).toBe(0);
    expect(toMinorUnits(Number.POSITIVE_INFINITY, 'BDT').amount).toBe(0);
  });

  it('handles a negative price, which the legacy data does contain', () => {
    expect(toMinorUnits(-5.5, 'BDT').amount).toBe(-550);
  });
});

describe('isMigratableObjectId', () => {
  it('accepts a real 24-hex ObjectId', () => {
    expect(isMigratableObjectId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('rejects the legacy temp- cart id so it is quarantined, not crashed on', () => {
    // Section 12.1 hazard 1. The legacy client wrote cart ids like
    // temp-1699999999999, which new ObjectId() throws on.
    expect(isMigratableObjectId('temp-1699999999999')).toBe(false);
  });

  it('rejects an empty or undefined id', () => {
    expect(isMigratableObjectId('')).toBe(false);
    expect(isMigratableObjectId(undefined)).toBe(false);
  });

  it('rejects a 24-character string that is not hex', () => {
    expect(isMigratableObjectId('zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
  });
});

describe('normaliseRole', () => {
  it('maps a known role', () => {
    expect(normaliseRole('admin')).toBe('admin');
    expect(normaliseRole('seller')).toBe('seller');
    expect(normaliseRole('buyer')).toBe('buyer');
  });

  it('is case-insensitive', () => {
    expect(normaliseRole('Admin')).toBe('admin');
  });

  it('defaults a missing role to buyer', () => {
    // Section 12.1 hazard 4.
    expect(normaliseRole(undefined)).toBe('buyer');
    expect(normaliseRole('')).toBe('buyer');
  });

  it('defaults an unrecognised role to buyer rather than throwing', () => {
    expect(normaliseRole('wizard')).toBe('buyer');
  });
});

describe('dedupeAds', () => {
  it('collapses a row present in both ads and approvedAds', () => {
    // Section 12.1 hazard 2: approvedAds duplicates rows in ads. The legacy
    // DELETE /approvedAds/:id even deleted from the wrong collection.
    const merged = dedupeAds(
      [
        { _id: 'a1', title: 'Sale' },
        { _id: 'a2', title: 'Promo' },
      ],
      [{ _id: 'a1', title: 'Sale' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.filter((a) => a._id === 'a1')).toHaveLength(1);
  });

  it('marks a row that appeared in approvedAds as approved', () => {
    const merged = dedupeAds([{ _id: 'a1', title: 'Sale' }], [{ _id: 'a1', title: 'Sale' }]);
    expect(merged[0]?.status).toBe('APPROVED');
  });

  it('marks a row absent from approvedAds as pending', () => {
    const merged = dedupeAds([{ _id: 'a2', title: 'Promo' }], []);
    expect(merged[0]?.status).toBe('PENDING');
  });

  it('keeps an approvedAds row that has no counterpart in ads', () => {
    // Orphaned approvals exist in the legacy data because the delete bug
    // removed from the wrong collection.
    const merged = dedupeAds([], [{ _id: 'orphan', title: 'Orphaned' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe('APPROVED');
  });

  it('returns an empty list for empty input', () => {
    expect(dedupeAds([], [])).toEqual([]);
  });
});
