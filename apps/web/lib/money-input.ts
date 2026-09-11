/**
 * Turning what a person typed into integer minor units.
 *
 * The one place a decimal string is allowed to become money, and it does the
 * conversion with STRING ARITHMETIC rather than `Math.round(value * 100)`.
 * `2400.10 * 100` is 240009.99999999997 in IEEE-754, and rounding hides that
 * until the day it does not - `@nexmarket/shared` exists because the legacy
 * server did `parseInt(price * 100)` and truncated. Splitting on the decimal
 * point and padding cannot drift.
 *
 * Returns null for anything that is not a number a person would write on a
 * receipt, so the caller can say what it wants rather than guessing at zero.
 */
export function toMinorUnits(input: string, decimals = 2): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;

  // Optional sign, digits, optionally a point and up to `decimals` digits.
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (match === null) return null;

  const [, sign = '', whole = '', fraction = ''] = match;
  // "." alone, or an empty string on both sides, is not a number.
  if (whole === '' && fraction === '') return null;
  if (fraction.length > decimals) return null;

  const padded = fraction.padEnd(decimals, '0');
  const combined = `${whole === '' ? '0' : whole}${padded}`;

  const value = Number.parseInt(combined, 10);
  if (!Number.isSafeInteger(value)) return null;

  return sign === '-' ? -value : value;
}
