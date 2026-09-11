import { describe, expect, it } from 'vitest';
import { toMinorUnits } from './money-input';

describe('toMinorUnits', () => {
  it('reads what a person writes on a receipt', () => {
    expect(toMinorUnits('2400')).toBe(240_000);
    expect(toMinorUnits('2400.50')).toBe(240_050);
    expect(toMinorUnits('0.05')).toBe(5);
    expect(toMinorUnits('.5')).toBe(50);
    expect(toMinorUnits('7.')).toBe(700);
  });

  it('does NOT drift the way float arithmetic does', () => {
    // `2400.10 * 100` is 240009.99999999997 in IEEE-754. This is the whole
    // reason the conversion is string arithmetic: the legacy server did
    // `parseInt(price * 100)` and truncated, and that bug is what
    // @nexmarket/shared exists to make unrepresentable.
    expect(toMinorUnits('2400.10')).toBe(240_010);
    expect(toMinorUnits('1.10')).toBe(110);
    expect(toMinorUnits('8.20')).toBe(820);
    expect(toMinorUnits('1.005')).toBeNull();
  });

  it('ignores thousands separators', () => {
    expect(toMinorUnits('31,600')).toBe(3_160_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(toMinorUnits('  2400.50  ')).toBe(240_050);
  });

  it('refuses more precision than the currency has', () => {
    // Accepting 2400.501 would mean silently deciding whether to round up or
    // down on somebody's money.
    expect(toMinorUnits('2400.501')).toBeNull();
  });

  it('refuses anything that is not a number', () => {
    expect(toMinorUnits('')).toBeNull();
    expect(toMinorUnits('   ')).toBeNull();
    expect(toMinorUnits('.')).toBeNull();
    expect(toMinorUnits('2400 taka')).toBeNull();
    expect(toMinorUnits('৳2400')).toBeNull();
    expect(toMinorUnits('1e5')).toBeNull();
    expect(toMinorUnits('NaN')).toBeNull();
  });

  it('carries a negative sign through', () => {
    // Not used by the COD form, which refuses anything at or below zero - but a
    // helper that silently dropped the sign would be a trap for the first
    // caller that needs a reversal.
    expect(toMinorUnits('-12.34')).toBe(-1234);
  });

  it('refuses a number too large to stay exact', () => {
    expect(toMinorUnits('99999999999999999999')).toBeNull();
  });

  it('takes the precision as a parameter for currencies that differ', () => {
    // JPY has none. Hard-coding two would make every yen amount 100x.
    expect(toMinorUnits('2400', 0)).toBe(2400);
    expect(toMinorUnits('2400.5', 0)).toBeNull();
  });
});
