import type { Money } from '@nexmarket/api-client';

/**
 * Money is integer MINOR UNITS everywhere in this system - `@nexmarket/shared`
 * exists to make that unrepresentable as a float. Formatting is the one place
 * it becomes a decimal, and it happens once, here.
 *
 * The legacy server did `parseInt(price * 100)`, which truncates. Nothing in
 * this file multiplies or divides anything it will later store.
 */

const SYMBOLS: Record<string, string> = {
  BDT: '৳',
  INR: '₹',
  USD: '$',
  AED: 'AED ',
};

/** Currencies whose minor unit is not 1/100. None in use yet; listed so the
 *  assumption is visible rather than buried in a `/ 100`. */
const MINOR_UNITS: Record<string, number> = { BDT: 2, INR: 2, USD: 2, AED: 2 };

/**
 * `en-BD` groups digits the way this market reads them - ৳1,50,000 rather than
 * ৳150,000. Getting that wrong is the kind of detail that quietly marks a
 * storefront as built for somewhere else.
 */
const LOCALE = 'en-BD';

export function formatMoney(money: Money, options: { decimals?: boolean } = {}): string {
  const exponent = MINOR_UNITS[money.currency] ?? 2;
  const major = money.amount / 10 ** exponent;
  const symbol = SYMBOLS[money.currency] ?? `${money.currency} `;

  // Whole amounts lose the ".00": a comparison table of prices reads faster
  // without two zeros repeated down every row, and paisa are not quoted here.
  const showDecimals = options.decimals ?? !Number.isInteger(major);

  return `${symbol}${major.toLocaleString(LOCALE, {
    minimumFractionDigits: showDecimals ? exponent : 0,
    maximumFractionDigits: showDecimals ? exponent : 0,
  })}`;
}

/** The difference between two amounts, as a signed string. Used where a total
 *  moved and the buyer needs to see by how much, not just that it did. */
export function formatDelta(from: Money, to: Money): string {
  const difference = to.amount - from.amount;
  const sign = difference > 0 ? '+' : '−';
  return `${sign}${formatMoney({ amount: Math.abs(difference), currency: to.currency })}`;
}

/**
 * Dispatch days as a buyer reads them.
 *
 * "Arrives" rather than "dispatches" would be a lie until Phase 6 quotes a real
 * delivery zone, so the wording stays on the thing the seller actually
 * committed to.
 */
export function formatDispatch(days: number): string {
  if (days <= 0) return 'Ships today';
  if (days === 1) return 'Ships tomorrow';
  return `Ships in ${String(days)} days`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Sentence-case plural without a library, for the handful of counts we show. */
export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
