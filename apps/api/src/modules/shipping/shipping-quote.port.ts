import type { Money } from '@nexmarket/shared';

export const SHIPPING_QUOTE_PROVIDER = Symbol('SHIPPING_QUOTE_PROVIDER');

export type ShippingQuoteRequest = {
  readonly sellerId: string;
  /** The seller group's subtotal, which is what a free-shipping threshold reads. */
  readonly subtotal: Money;
  readonly itemCount: number;
  /** Phase 6 resolves these to a zone; the flat-rate adapter ignores them. */
  readonly postcode: string;
  readonly countryCode: string;
};

/**
 * PRD 9.1: "Shipping method and delivery slot per seller group", and PRD 10.3's
 * `ShippingProvider` port.
 *
 * A port rather than a function, because Phase 6 replaces the implementation
 * wholesale with zone lookups, weight bands and dimensional weight. Everything
 * upstream quotes per SELLER GROUP - one cart spanning three sellers pays three
 * shipping fees, because three parcels leave three warehouses - and that shape
 * does not change when the adapter does.
 *
 * Quoting is deliberately synchronous and pure with respect to the database: a
 * quote that hit a carrier API would make checkout's latency and failure modes
 * someone else's, and PRD 13 budgets checkout at p95 < 500 ms.
 */
export interface ShippingQuoteProvider {
  readonly name: string;
  quote(request: ShippingQuoteRequest): Money;
}
