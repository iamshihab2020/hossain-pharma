/**
 * Money is always integer minor units (paisa, cents) plus an explicit currency.
 * PRD section 8.4: no floats in any pricing, tax, discount, shipping or ledger path.
 *
 * The legacy server did `parseInt(price * 100)`, which truncates rather than rounds:
 * 19.99 * 100 is 1998.9999999999998 in IEEE 754, so it charged 1998. This module
 * exists to make that class of bug unrepresentable.
 */
export type Money = {
  readonly amount: number;
  readonly currency: string;
};

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Money.amount must be integer minor units, received ${amount}`);
  }
  if (!CURRENCY_RE.test(currency)) {
    throw new RangeError(
      `Money.currency must be a 3-letter uppercase ISO code, received ${currency}`,
    );
  }
  return { amount, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/** Rounds half away from zero, so -99.5 becomes -100 and 99.5 becomes 100. */
export function multiply(m: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Multiplication factor must be finite, received ${factor}`);
  }
  const raw = m.amount * factor;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, m.currency);
}

/**
 * Splits an amount across weighted parts with no loss. Every minor unit in the
 * input appears in exactly one output part, so the parts always sum back to the
 * original.
 *
 * This is how one buyer payment splits across several sellers in a multi-seller
 * order, and how a partial refund splits back. Phase 4's ledger depends on the
 * sum being exact.
 *
 * Each part floors, losing strictly less than one minor unit, so the total
 * remainder is always less than the number of parts. One pass handing out a
 * single unit each therefore exhausts it.
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) {
    throw new RangeError('allocate requires at least one ratio');
  }
  for (const r of ratios) {
    if (!Number.isFinite(r) || r < 0) {
      throw new RangeError(`allocate ratios must be finite and non-negative, received ${r}`);
    }
  }
  const total = ratios.reduce((acc, r) => acc + r, 0);
  if (total === 0) {
    throw new RangeError('allocate ratios must not sum to zero');
  }

  const sign = m.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(m.amount);

  const floored = ratios.map((r) => Math.floor((magnitude * r) / total));
  let remainder = magnitude - floored.reduce((acc, s) => acc + s, 0);

  return floored.map((share) => {
    if (remainder > 0) {
      remainder -= 1;
      return money(sign * (share + 1), m.currency);
    }
    return money(sign * share, m.currency);
  });
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

/** Debug and ledger-audit rendering. User-facing formatting is a Phase 12 i18n concern. */
export function formatMinor(m: Money): string {
  return `${m.amount} ${m.currency}`;
}
