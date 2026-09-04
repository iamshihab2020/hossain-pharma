import { type Money, money, multiply } from './money.js';

/**
 * Commission and tax, as pure functions over integer minor units.
 *
 * Neither of these gets a port. PRD 10 names five ports - payment, shipping,
 * search, storage, notification - and neither commission nor tax is among them.
 * Commission is a rate table the platform owns; tax is a rate per country.
 * Wrapping either in an adapter interface would imply a swap that is not
 * planned and would make two files out of eight lines.
 */

/**
 * BASIS POINTS, not percent.
 *
 * 2.5% is not representable as an integer percentage, and the alternative -
 * storing 0.025 - puts a float in a money path, which is the exact bug
 * @nexmarket/shared exists to make unrepresentable. 10000 bps = 100%.
 */
export const PLATFORM_DEFAULT_COMMISSION_BPS = 1000;

export const MAX_COMMISSION_BPS = 10_000;

/**
 * Resolves PRD open question Q3 with its own stated default: per-category with
 * a platform default, plus a per-seller override for the negotiated deals
 * PRD 9.3 asks for.
 *
 * Most specific wins: seller, then category, then platform.
 */
export function resolveCommissionBps(
  sellerBps: number | null | undefined,
  categoryBps: number | null | undefined,
): number {
  const resolved = sellerBps ?? categoryBps ?? PLATFORM_DEFAULT_COMMISSION_BPS;
  assertBps(resolved);
  return resolved;
}

/**
 * The platform's cut of one seller's subtotal.
 *
 * Rounding is `multiply`'s - half away from zero - and is deliberately reused
 * rather than re-derived, so commission rounds the same way every other
 * proportional amount in the system does. A second rounding rule is a
 * reconciliation bug that only appears at scale.
 */
export function commissionFor(subtotal: Money, bps: number): Money {
  assertBps(bps);
  if (subtotal.amount < 0) {
    throw new RangeError(`Commission needs a non-negative subtotal, received ${subtotal.amount}`);
  }
  return multiply(subtotal, bps / MAX_COMMISSION_BPS);
}

/**
 * Tax rates by country, in basis points.
 *
 * Deliberately thin, and deliberately not pretending otherwise: this is a
 * single rate per country with no jurisdictions, exemptions, registrations or
 * per-category rates. Those are out of scope for every phase in this PRD, and a
 * table with a `state` column that nothing populates would be a promise the
 * codebase does not keep.
 *
 * BD is the primary market (PRD open question Q1), where VAT is 15%.
 */
const TAX_BPS_BY_COUNTRY: Readonly<Record<string, number>> = {
  BD: 1500,
};

/** Countries absent from the table are taxed at zero, and that is a decision. */
export function taxBpsFor(countryCode: string): number {
  return TAX_BPS_BY_COUNTRY[countryCode.toUpperCase()] ?? 0;
}

export function taxFor(taxable: Money, countryCode: string): Money {
  if (taxable.amount < 0) {
    throw new RangeError(`Tax needs a non-negative amount, received ${taxable.amount}`);
  }
  return multiply(taxable, taxBpsFor(countryCode) / MAX_COMMISSION_BPS);
}

/**
 * One order line's money, computed in one place so the quote and the persisted
 * order item cannot disagree about what a line costs.
 */
export function lineTotal(unitPrice: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`Quantity must be a positive integer, received ${quantity}`);
  }
  return money(unitPrice.amount * quantity, unitPrice.currency);
}

function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) {
    throw new RangeError(`Basis points must be an integer in 0..${MAX_COMMISSION_BPS}, received ${bps}`);
  }
}
