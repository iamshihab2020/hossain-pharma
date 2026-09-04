import { describe, expect, it } from 'vitest';
import { money } from './money.js';
import {
  MAX_COMMISSION_BPS,
  PLATFORM_DEFAULT_COMMISSION_BPS,
  commissionFor,
  lineTotal,
  resolveCommissionBps,
  taxBpsFor,
  taxFor,
} from './pricing.js';

const bdt = (amount: number) => money(amount, 'BDT');

describe('resolveCommissionBps', () => {
  it('falls back to the platform default when nothing overrides it', () => {
    expect(resolveCommissionBps(null, null)).toBe(PLATFORM_DEFAULT_COMMISSION_BPS);
    expect(resolveCommissionBps(undefined, undefined)).toBe(PLATFORM_DEFAULT_COMMISSION_BPS);
  });

  it('prefers the category rate over the platform default', () => {
    expect(resolveCommissionBps(null, 250)).toBe(250);
  });

  it('prefers the seller rate over both — most specific wins', () => {
    expect(resolveCommissionBps(150, 250)).toBe(150);
  });

  it('treats an explicit zero as a real rate, not as absent', () => {
    expect(resolveCommissionBps(0, 250)).toBe(0);
    expect(resolveCommissionBps(null, 0)).toBe(0);
  });

  it('rejects a rate above 100 percent', () => {
    expect(() => resolveCommissionBps(MAX_COMMISSION_BPS + 1, null)).toThrow(RangeError);
  });

  it('rejects a negative or fractional rate', () => {
    expect(() => resolveCommissionBps(-1, null)).toThrow(RangeError);
    expect(() => resolveCommissionBps(12.5, null)).toThrow(RangeError);
  });
});

describe('commissionFor', () => {
  it('takes the PRD 10.1 example rate', () => {
    expect(commissionFor(bdt(600), 1000)).toEqual(bdt(60));
    expect(commissionFor(bdt(400), 1000)).toEqual(bdt(40));
  });

  it('rounds half away from zero, the same way every other proportional amount does', () => {
    // 1 bps of 15000 is exactly 1.5 minor units.
    expect(commissionFor(bdt(15_000), 1)).toEqual(bdt(2));
    // 1 bps of 5000 is exactly 0.5.
    expect(commissionFor(bdt(5_000), 1)).toEqual(bdt(1));
  });

  it('is zero at a zero rate and the whole amount at 100 percent', () => {
    expect(commissionFor(bdt(999), 0)).toEqual(bdt(0));
    expect(commissionFor(bdt(999), MAX_COMMISSION_BPS)).toEqual(bdt(999));
  });

  it('preserves the currency', () => {
    expect(commissionFor(money(1000, 'USD'), 1000)).toEqual(money(100, 'USD'));
  });

  it('rejects a negative subtotal', () => {
    expect(() => commissionFor(bdt(-1), 1000)).toThrow(RangeError);
  });

  it('rejects an out-of-range rate', () => {
    expect(() => commissionFor(bdt(100), MAX_COMMISSION_BPS + 1)).toThrow(RangeError);
  });
});

describe('taxFor', () => {
  it('applies 15 percent VAT in Bangladesh, the primary market', () => {
    expect(taxBpsFor('BD')).toBe(1500);
    expect(taxFor(bdt(1000), 'BD')).toEqual(bdt(150));
  });

  it('is case-insensitive on the country code', () => {
    expect(taxBpsFor('bd')).toBe(1500);
  });

  it('taxes an unlisted country at zero, which is a decision and not an omission', () => {
    expect(taxBpsFor('US')).toBe(0);
    expect(taxFor(bdt(1000), 'US')).toEqual(bdt(0));
  });

  it('rejects a negative taxable amount', () => {
    expect(() => taxFor(bdt(-1), 'BD')).toThrow(RangeError);
  });
});

describe('lineTotal', () => {
  it('multiplies unit price by quantity in minor units', () => {
    expect(lineTotal(bdt(4250), 3)).toEqual(bdt(12_750));
  });

  it('rejects a zero, negative or fractional quantity', () => {
    expect(() => lineTotal(bdt(100), 0)).toThrow(RangeError);
    expect(() => lineTotal(bdt(100), -1)).toThrow(RangeError);
    expect(() => lineTotal(bdt(100), 1.5)).toThrow(RangeError);
  });
});
