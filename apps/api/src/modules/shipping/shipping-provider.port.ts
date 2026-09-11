export const SHIPPING_PROVIDER = Symbol('SHIPPING_PROVIDER');

/**
 * The states a carrier reports, in the order they happen.
 *
 * Deliberately the same four as `shipment_status`. A provider vocabulary that
 * differed from the column would need a mapping table, and a mapping table is
 * where a carrier's "ARRIVED_AT_HUB" quietly becomes "DELIVERED".
 */
export const TRACKING_EVENTS = [
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export type TrackingEventType = (typeof TRACKING_EVENTS)[number];

export type TrackingEvent = {
  readonly type: TrackingEventType;
  readonly occurredAt: Date;
  readonly description: string;
  /** Where the parcel was when the carrier scanned it. */
  readonly location: string;
};

export type BookingRequest = {
  readonly shipmentId: string;
  readonly originPostcode: string;
  readonly destinationPostcode: string;
  readonly chargeableGrams: number | null;
};

export type Booking = {
  readonly carrierName: string;
  readonly trackingNumber: string;
};

/**
 * PRD 10.3's `ShippingProvider`, and the second half of PRD 11 Phase 6: "a
 * time-compressed mock adapter emitting realistic tracking events".
 *
 * SEPARATE FROM `ShippingQuoteProvider`, and that split is deliberate. Quoting
 * happens on the checkout path, is synchronous, pure and budgeted at p95 <
 * 500 ms; booking and tracking happen after the money has moved, are inherently
 * asynchronous, and talk to somebody else's network. Wrapping both in one
 * interface would force the quote to inherit the tracker's failure modes - the
 * exact reason `shipping-quote.port.ts` says quoting must never hit a carrier
 * API.
 *
 * Tracking arrives by WEBHOOK, not by polling. The port exposes `book`, and the
 * carrier calls `POST /webhooks/shipping/:provider` when something happens. A
 * poller would need a schedule, a cursor and a story about missed windows, all
 * to learn something the carrier already knows and will tell us.
 */
export interface ShippingProvider {
  readonly name: string;
  /** Hands the parcel over and gets back a tracking number. */
  book(request: BookingRequest): Promise<Booking>;
  /** Verifies a webhook came from this carrier. */
  verify(payload: string, signature: string | undefined): boolean;
}
