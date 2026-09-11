import type { Money, RateBand } from '@nexmarket/shared';

export const SHIPPING_QUOTE_PROVIDER = Symbol('SHIPPING_QUOTE_PROVIDER');

/**
 * The zone a postcode resolved to, and its rate card, resolved by the CALLER.
 *
 * `null` means the postcode is not serviceable - a real answer PRD 8.4 asks the
 * product page to render, not a lookup failure.
 */
export type QuoteZone = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly areaName: string;
  readonly codAllowed: boolean;
  readonly transitDaysMin: number;
  readonly transitDaysMax: number;
  readonly bands: readonly RateBand[];
};

export type ShippingQuoteRequest = {
  readonly sellerId: string;
  /** The seller group's subtotal, which is what a free-shipping threshold reads. */
  readonly subtotal: Money;
  readonly itemCount: number;
  readonly postcode: string;
  readonly countryCode: string;

  /**
   * Resolved by the caller, not looked up here. See the note on purity below.
   * `null` when the postcode serves no zone.
   */
  readonly zone: QuoteZone | null;

  /**
   * Total CHARGEABLE weight for this seller group, in grams - `max(actual,
   * volumetric)` summed over the lines, computed by `chargeableWeightGrams`.
   *
   * `null` when any line in the group is an unmeasured variant. Not zero:
   * zero is a weight and would quote the cheapest band for a catalogue nobody
   * has measured, which is the silent under-charge the nullable columns exist
   * to avoid.
   */
  readonly chargeableGrams: number | null;
};

/**
 * PRD 9.1: "Shipping method and delivery slot per seller group", and PRD 10.3's
 * `ShippingProvider` port.
 *
 * Everything upstream quotes per SELLER GROUP - one cart spanning three sellers
 * pays three shipping fees, because three parcels leave three warehouses - and
 * that shape did not change when Phase 6 replaced the adapter.
 *
 * STILL SYNCHRONOUS AND STILL PURE with respect to the database, which Phase 6
 * had to work to preserve. Zone rates live in tables, so the obvious move was
 * to make `quote` async and let the adapter read them; that would have put a
 * per-seller-group round trip inside a loop on the checkout path, which PRD 13
 * budgets at p95 < 500 ms. Instead the CALLER resolves the postcode to a zone
 * once and hands the rate card in. The adapter stays a pure function of its
 * arguments, which is what lets the interesting cases - the volumetric cliff,
 * the parcel over the ceiling, the unserviceable postcode - be unit tests
 * rather than fixtures.
 */
export interface ShippingQuoteProvider {
  readonly name: string;
  quote(request: ShippingQuoteRequest): Money;
}
