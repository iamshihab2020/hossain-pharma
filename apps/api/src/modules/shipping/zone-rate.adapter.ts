import { Injectable } from '@nestjs/common';
import { type Money, money, rateFor } from '@nexmarket/shared';
import { FREE_SHIPPING_THRESHOLD_MINOR, FlatRateShippingAdapter } from './flat-rate.adapter.js';
import type { ShippingQuoteProvider, ShippingQuoteRequest } from './shipping-quote.port.js';

/**
 * The Phase 6 shipping adapter: a zone rate card keyed on chargeable weight.
 *
 * Replaces the flat rate behind the same port, and KEEPS IT as the floor rather
 * than deleting it. Three cases fall back, and each is a real gap rather than
 * an error:
 *
 *   1. The postcode serves no zone. The buy box still has to rank offers for a
 *      visitor who has not told anyone where they are, and it ranks on landed
 *      price - so an unserviceable or unknown postcode needs a number, not an
 *      exception. The product page renders the unserviceable answer separately,
 *      from `zone === null`, which is the honest place for it.
 *   2. The group contains an unmeasured variant. The catalogue predates the
 *      weight columns.
 *   3. The parcel is heavier than the heaviest band. Above the ceiling a rate
 *      card has no opinion, and extrapolating one would quote a piano at
 *      suitcase rates.
 *
 * Falling back is visible in the quote's `basis`, so nothing downstream
 * mistakes a flat rate for a zone rate - the same discipline the buy box's
 * `BUY_BOX_BASIS` established in Phase 2.
 */
@Injectable()
export class ZoneRateShippingAdapter implements ShippingQuoteProvider {
  readonly name = 'zone-rate';

  constructor(private readonly flat: FlatRateShippingAdapter) {}

  quote(request: ShippingQuoteRequest): Money {
    if (request.itemCount === 0) return money(0, request.subtotal.currency);

    /**
     * The free-shipping threshold is checked BEFORE the rate card, not after.
     *
     * It is the platform's promise and it has to hold whatever the parcel
     * weighs - a threshold that quietly stopped applying to heavy orders would
     * be a promise broken exactly where it costs the buyer most, and it is the
     * mechanism that makes the buy box's landed-price ranking observable at
     * checkout (a seller with a higher sticker price winning on delivered
     * cost). Phase 9 turns this into a funded promotion; today it is a rule.
     */
    if (request.subtotal.amount >= FREE_SHIPPING_THRESHOLD_MINOR) {
      return money(0, request.subtotal.currency);
    }

    const { zone, chargeableGrams } = request;
    if (zone === null || chargeableGrams === null) return this.flat.quote(request);

    const rate = rateFor(zone.bands, chargeableGrams);
    if (rate === null) return this.flat.quote(request);

    /**
     * Currency is the SUBTOTAL's, and a rate card in another one is a
     * misconfiguration rather than something to convert. Converting here would
     * put a floating-point exchange rate in a money path, which is the one
     * thing @nexmarket/shared exists to make unrepresentable.
     */
    if (rate.currency !== request.subtotal.currency) {
      return this.flat.quote(request);
    }

    return rate;
  }
}

/** What produced a quote, so a fallback is never mistaken for a zone rate. */
export type QuoteBasis =
  | 'zone-rate'
  | 'flat-shipping'
  | 'free-shipping-threshold'
  | 'no-items';

/**
 * The basis for a request, computed the same way `quote` decides.
 *
 * Deliberately a second function over the same inputs rather than a second
 * return value, because the port returns `Money` and widening it would change
 * every caller for a string only the storefront reads. The two are kept honest
 * by a test that walks the same cases through both.
 */
export function basisFor(request: ShippingQuoteRequest): QuoteBasis {
  /**
   * The empty group first, and in the SAME order `quote` checks it.
   *
   * The first version omitted this and reported 'zone-rate' for a group with
   * no items - `quote` had already returned zero from its own empty-group
   * short-circuit, so the two functions disagreed about a cart nobody can
   * check out. The consistency test at the bottom of the spec is what caught
   * it, which is most of why that test exists rather than trusting two
   * functions to stay in step by inspection.
   */
  if (request.itemCount === 0) return 'no-items';

  if (request.subtotal.amount >= FREE_SHIPPING_THRESHOLD_MINOR) {
    return 'free-shipping-threshold';
  }
  if (request.zone === null || request.chargeableGrams === null) return 'flat-shipping';

  const rate = rateFor(request.zone.bands, request.chargeableGrams);
  if (rate === null || rate.currency !== request.subtotal.currency) return 'flat-shipping';
  return 'zone-rate';
}
