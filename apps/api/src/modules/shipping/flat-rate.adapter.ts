import { Injectable } from '@nestjs/common';
import { type Money, money } from '@nexmarket/shared';
import type { ShippingQuoteProvider, ShippingQuoteRequest } from './shipping-quote.port.js';

/** Per seller group, in minor units. Phase 6 replaces this with zone rate cards. */
export const FLAT_RATE_MINOR = 6_000;

/** Free shipping at or above this per-seller subtotal. */
export const FREE_SHIPPING_THRESHOLD_MINOR = 100_000;

/**
 * The Phase 4 shipping adapter: a flat rate per seller group, free over a
 * threshold.
 *
 * Deliberately crude, and deliberately NOT dressed up as more than it is.
 * Serviceability, zones, weight bands and delivery slots are Phase 6 and need
 * tables that do not exist yet; a rate that varied by postcode using numbers
 * invented here would be a lie with a decimal point in it.
 *
 * The threshold is real behaviour rather than decoration: it is what makes the
 * buy box's landed-price ranking observable in checkout, and it is why the
 * acceptance fixture can have a seller whose higher sticker price still wins.
 */
@Injectable()
export class FlatRateShippingAdapter implements ShippingQuoteProvider {
  readonly name = 'flat-rate';

  quote(request: ShippingQuoteRequest): Money {
    if (request.itemCount === 0) return money(0, request.subtotal.currency);
    if (request.subtotal.amount >= FREE_SHIPPING_THRESHOLD_MINOR) {
      return money(0, request.subtotal.currency);
    }
    return money(FLAT_RATE_MINOR, request.subtotal.currency);
  }
}
