import { type Money, money } from './money.js';

/**
 * Phase 6 shipping arithmetic, as pure functions over integers.
 *
 * Framework-free and database-free on purpose, like `pricing.ts` beside it. The
 * zone-rate adapter reads rows and calls these; nothing here knows a row exists.
 * That is what lets the interesting cases - the volumetric cliff, the parcel
 * over the heaviest band, the zero-dimension variant - be tested as arithmetic
 * rather than through a fixture.
 */

/**
 * The volumetric divisor, in the courier industry's own units: cm³ per kg.
 *
 * 5000 is the IATA/express-courier convention and what every Bangladeshi
 * courier quotes against. It is a CONSTANT rather than a column because a
 * divisor that varied by zone would let the same box cost two different
 * volumetric weights on two legs of one journey, and no carrier prices that way.
 * If a carrier ever needs 6000, that is an adapter, not a config row.
 */
export const VOLUMETRIC_DIVISOR_CM3_PER_KG = 5000;

export type Dimensions = {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

/**
 * Volumetric weight in GRAMS, from millimetre dimensions.
 *
 * The unit conversion is worth stating because it is where this goes wrong:
 * a box in mm³ is `mm³ / 1000` cm³, volumetric kg is `cm³ / 5000`, and grams is
 * `kg × 1000`. The three factors collapse to a single divide by 5000, which
 * looks like a coincidence and is not - it is why the constant above is named
 * for its real units rather than for the number that survives the algebra.
 *
 * A 10 cm cube is 1000 cm³, so 0.2 kg, so 200 g: `100 × 100 × 100 / 5000`.
 *
 * Rounded UP. A courier bills the band a parcel falls into, and rounding a
 * fraction of a gram down is how a parcel sitting exactly on a band boundary
 * gets quoted one band too cheap - the platform absorbs the difference silently
 * and only at scale.
 */
export function volumetricWeightGrams(dimensions: Dimensions): number {
  const { lengthMm, widthMm, heightMm } = dimensions;
  assertPositive(lengthMm, 'lengthMm');
  assertPositive(widthMm, 'widthMm');
  assertPositive(heightMm, 'heightMm');

  return Math.ceil((lengthMm * widthMm * heightMm) / VOLUMETRIC_DIVISOR_CM3_PER_KG);
}

/**
 * What the parcel is BILLED at: the greater of what it weighs and what it
 * displaces.
 *
 * This is the whole reason dimensions are stored at all. A duvet weighs almost
 * nothing and fills a van; a phone battery is the opposite. Billing actual
 * weight alone means the platform funds every bulky item's van space out of
 * commission, which is invisible until the catalogue grows a furniture
 * category.
 *
 * Dimensions are optional because the catalogue predates them (`weight_grams`
 * and the three millimetre columns are nullable, and the variant table carries
 * a `num_nonnulls(...) IN (0, 3)` check so a partial box cannot reach here).
 * An unmeasured box bills its actual weight - the honest answer, and the one
 * that never over-charges a seller for a measurement nobody took.
 */
export function chargeableWeightGrams(
  actualGrams: number,
  dimensions: Dimensions | null,
): number {
  assertPositive(actualGrams, 'actualGrams');
  if (dimensions === null) return actualGrams;
  return Math.max(actualGrams, volumetricWeightGrams(dimensions));
}

/**
 * One row of a zone's rate card. `maxWeightGrams` is the band's INCLUSIVE upper
 * bound.
 */
export type RateBand = {
  readonly maxWeightGrams: number;
  readonly amount: Money;
};

/**
 * The rate for a parcel, or `null` when it is heavier than the heaviest band.
 *
 * NULL IS A REAL ANSWER, not a failure to find one. A rate card has a ceiling
 * because couriers have one, and a parcel above it needs freight rather than an
 * extrapolated price. Returning the top band instead would quote a piano at
 * suitcase rates and discover the mistake at the depot.
 *
 * Bands need not arrive sorted; this sorts them, because the caller reading
 * them out of a table has no reason to guarantee an order and a silent
 * dependency on one is the kind that survives every test written against a
 * seed.
 */
export function rateFor(bands: readonly RateBand[], chargeableGrams: number): Money | null {
  assertPositive(chargeableGrams, 'chargeableGrams');

  const fits = bands
    .filter((band) => band.maxWeightGrams >= chargeableGrams)
    .sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);

  return fits[0]?.amount ?? null;
}

/**
 * Adds the rates for several parcels, which is what a seller group with more
 * than one warehouse produces.
 *
 * Refuses to mix currencies rather than coercing, for the reason `money.ts`
 * gives everywhere else: two amounts in different currencies have no sum, and
 * quietly taking the first one's currency is how a BDT total ends up labelled
 * USD.
 */
export function sumRates(rates: readonly Money[]): Money | null {
  const first = rates[0];
  if (first === undefined) return null;

  let total = 0;
  for (const rate of rates) {
    if (rate.currency !== first.currency) {
      throw new Error(`Cannot sum ${first.currency} and ${rate.currency} shipping rates`);
    }
    total += rate.amount;
  }
  return money(total, first.currency);
}

/**
 * The delivery estimate, in whole days from today, as a RANGE.
 *
 * Two numbers because it is an estimate, and a single number reads as a
 * promise. PRD 8.4 asks for a "delivery estimate" on the product page and the
 * buy box's own footnote exists because an estimate presented as a quote is the
 * thing buyers never forgive.
 *
 * DISPATCH AND TRANSIT ARE ADDED HERE AND STORED APART. How fast a box leaves
 * the warehouse is the seller's performance (`listings.dispatch_days`); how
 * fast it crosses the country is the zone's (`delivery_zones.transit_days_*`).
 * Collapsing them into one stored number would attribute a courier's bad week
 * to the seller's SLA, and Phase 10's delivery-performance analytics needs them
 * separable.
 */
export type DeliveryWindow = { readonly earliestDays: number; readonly latestDays: number };

export function deliveryWindow(
  dispatchDays: number,
  transitDaysMin: number,
  transitDaysMax: number,
): DeliveryWindow {
  assertNonNegative(dispatchDays, 'dispatchDays');
  assertNonNegative(transitDaysMin, 'transitDaysMin');
  assertNonNegative(transitDaysMax, 'transitDaysMax');
  if (transitDaysMin > transitDaysMax) {
    throw new Error(`transitDaysMin ${transitDaysMin} exceeds transitDaysMax ${transitDaysMax}`);
  }

  return {
    earliestDays: dispatchDays + transitDaysMin,
    latestDays: dispatchDays + transitDaysMax,
  };
}

/**
 * The widest window covering several seller groups.
 *
 * A cart spanning three sellers has three windows, and the buyer wants one
 * sentence. The honest merge is the SLOWEST latest and the SOONEST earliest -
 * "between Saturday and next Thursday" - because the basket is not complete
 * until the last parcel lands. Averaging them would invent a date on which
 * nothing in particular happens.
 */
export function mergeWindows(windows: readonly DeliveryWindow[]): DeliveryWindow | null {
  const first = windows[0];
  if (first === undefined) return null;

  let earliest = first.earliestDays;
  let latest = first.latestDays;
  for (const window of windows) {
    earliest = Math.min(earliest, window.earliestDays);
    latest = Math.max(latest, window.latestDays);
  }
  return { earliestDays: earliest, latestDays: latest };
}

function assertPositive(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${String(value)}`);
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${String(value)}`);
  }
}
