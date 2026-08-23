import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  allocate,
  compare,
  formatMinor,
  isZero,
  money,
  multiply,
  subtract,
} from './money.js';

describe('money', () => {
  it('constructs from integer minor units', () => {
    expect(money(38500, 'BDT')).toEqual({ amount: 38500, currency: 'BDT' });
  });

  it('rejects a non-integer amount', () => {
    expect(() => money(38.5, 'BDT')).toThrow(/integer minor units/);
  });

  it('rejects a currency that is not a 3-letter uppercase code', () => {
    expect(() => money(100, 'bdt')).toThrow(/currency/);
    expect(() => money(100, 'TAKA')).toThrow(/currency/);
  });

  it('allows a negative amount, because refunds and credits exist', () => {
    expect(money(-500, 'BDT').amount).toBe(-500);
  });
});

describe('add and subtract', () => {
  it('adds two amounts in the same currency', () => {
    expect(add(money(100, 'BDT'), money(250, 'BDT'))).toEqual(money(350, 'BDT'));
  });

  it('subtracts two amounts in the same currency', () => {
    expect(subtract(money(250, 'BDT'), money(100, 'BDT'))).toEqual(money(150, 'BDT'));
  });

  it('throws CurrencyMismatchError across currencies', () => {
    expect(() => add(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });
});

describe('multiply', () => {
  it('multiplies by an integer exactly', () => {
    expect(multiply(money(199, 'BDT'), 3)).toEqual(money(597, 'BDT'));
  });

  it('rounds half away from zero on a fractional factor', () => {
    // 199 * 0.5 = 99.5 -> 100
    expect(multiply(money(199, 'BDT'), 0.5)).toEqual(money(100, 'BDT'));
    // -199 * 0.5 = -99.5 -> -100
    expect(multiply(money(-199, 'BDT'), 0.5)).toEqual(money(-100, 'BDT'));
  });

  it('rejects a non-finite factor', () => {
    expect(() => multiply(money(100, 'BDT'), Number.NaN)).toThrow(/finite/);
  });
});

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    const parts = allocate(money(900, 'BDT'), [1, 1, 1]);
    expect(parts).toEqual([money(300, 'BDT'), money(300, 'BDT'), money(300, 'BDT')]);
  });

  it('distributes the remainder to the earliest parts, losing nothing', () => {
    // The canonical case: 5 paisa across 3 ways is 2 + 2 + 1, not 1.67 each.
    const parts = allocate(money(5, 'BDT'), [1, 1, 1]);
    expect(parts).toEqual([money(2, 'BDT'), money(2, 'BDT'), money(1, 'BDT')]);
  });

  it('respects weighted ratios', () => {
    const parts = allocate(money(1000, 'BDT'), [3, 7]);
    expect(parts).toEqual([money(300, 'BDT'), money(700, 'BDT')]);
  });

  it('always sums back to the original amount', () => {
    for (const total of [1, 7, 99, 100, 12345, 999999]) {
      const parts = allocate(money(total, 'BDT'), [5, 3, 2, 1]);
      const sum = parts.reduce((acc, p) => acc + p.amount, 0);
      expect(sum).toBe(total);
    }
  });

  it('handles a negative total, so refunds split the same way', () => {
    const parts = allocate(money(-5, 'BDT'), [1, 1, 1]);
    expect(parts.reduce((acc, p) => acc + p.amount, 0)).toBe(-5);
  });

  it('rejects an empty ratio list', () => {
    expect(() => allocate(money(100, 'BDT'), [])).toThrow(/at least one/);
  });

  it('rejects a negative ratio', () => {
    expect(() => allocate(money(100, 'BDT'), [1, -1])).toThrow(/non-negative/);
  });

  it('rejects a non-finite ratio', () => {
    expect(() => allocate(money(100, 'BDT'), [1, Number.POSITIVE_INFINITY])).toThrow(/finite/);
    expect(() => allocate(money(100, 'BDT'), [1, Number.NaN])).toThrow(/finite/);
  });

  it('rejects ratios that sum to zero', () => {
    expect(() => allocate(money(100, 'BDT'), [0, 0])).toThrow(/sum to zero/);
  });
});

describe('helpers', () => {
  it('detects zero', () => {
    expect(isZero(money(0, 'BDT'))).toBe(true);
    expect(isZero(money(1, 'BDT'))).toBe(false);
  });

  it('compares within a currency', () => {
    expect(compare(money(100, 'BDT'), money(200, 'BDT'))).toBe(-1);
    expect(compare(money(200, 'BDT'), money(100, 'BDT'))).toBe(1);
    expect(compare(money(100, 'BDT'), money(100, 'BDT'))).toBe(0);
  });

  it('throws when comparing across currencies', () => {
    expect(() => compare(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('formats as minor units with the currency code', () => {
    expect(formatMinor(money(38500, 'BDT'))).toBe('38500 BDT');
  });
});
