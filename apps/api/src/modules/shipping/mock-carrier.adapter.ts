import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadApiEnv } from '../../config/env.js';
import type {
  Booking,
  ShippingProvider,
  TrackingEvent,
  TrackingEventType,
} from './shipping-provider.port.js';

/**
 * How far apart the mock's events fall, in real seconds.
 *
 * TIME-COMPRESSED, which PRD 11 Phase 6 asks for by name: a parcel that took
 * three real days to move would make the tracking timeline undemonstrable. Four
 * events over two minutes is long enough that a person watching sees them
 * arrive one at a time, and short enough that a demo does not stall.
 *
 * The compression lives HERE, in the adapter, and nothing downstream knows
 * about it. `order_events` stores real timestamps either way, so a real carrier
 * dropped in behind this port changes the pace and nothing else.
 */
export const MOCK_EVENT_INTERVAL_SECONDS = 30;

const CARRIER_NAME = 'NexMock Courier';

/**
 * The Phase 6 shipping adapter: a carrier that always accepts a parcel and
 * reports on it over compressed time.
 *
 * The events it emits are the four in `TRACKING_EVENTS`, in order, and the
 * schedule is DERIVED FROM THE TRACKING NUMBER rather than stored. That is what
 * makes it stateless: no timer, no queue, no row that has to survive a restart.
 * A caller asks "what has happened to PT-xxx by now?" and gets the same answer
 * whoever asks and however many times - which is also what makes it safe to
 * replay a webhook.
 */
@Injectable()
export class MockCarrierAdapter implements ShippingProvider {
  readonly name = 'mock';

  private readonly secret = loadApiEnv().SHIPPING_WEBHOOK_SECRET;

  /**
   * Takes NO argument, while the port declares one.
   *
   * TypeScript allows an implementation with fewer parameters, and that is the
   * honest shape here: this mock accepts every parcel regardless of origin,
   * destination or weight. The PORT keeps `BookingRequest` because a real
   * carrier needs all three to quote a consignment - narrowing the interface to
   * match the mock would make the mock the definition.
   */
  book(): Promise<Booking> {
    /**
     * The tracking number CARRIES ITS OWN BOOKING TIME, base-36 encoded.
     *
     * That is the whole trick behind a stateless mock: `eventsSoFar` reads the
     * timestamp back out and computes which events have happened, so there is
     * nothing to persist and nothing to clean up. A real carrier's number is
     * opaque and its events arrive by webhook; this one is opaque to everyone
     * except the adapter that minted it, which is the same contract.
     */
    const bookedAt = Date.now().toString(36).toUpperCase();
    const nonce = randomUUID().slice(0, 4).toUpperCase();
    return Promise.resolve({
      carrierName: CARRIER_NAME,
      trackingNumber: `NM${bookedAt}${nonce}`,
    });
  }

  verify(payload: string, signature: string | undefined): boolean {
    if (signature === undefined) return false;

    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // Length first: timingSafeEqual THROWS on a length mismatch, so comparing
    // without this turns a forged signature into a 500. Same fix as the payment
    // adapter's.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Every event that has happened to this parcel by `now`.
   *
   * Returns the whole history rather than just the latest, so a caller
   * replaying a webhook after a gap does not silently skip the states it missed
   * - a parcel that jumps DISPATCHED to DELIVERED loses the timeline the
   * feature exists to show.
   */
  eventsSoFar(trackingNumber: string, now: Date = new Date()): TrackingEvent[] {
    const bookedAt = this.bookedAtFrom(trackingNumber);
    if (bookedAt === null) return [];

    const elapsedSeconds = (now.getTime() - bookedAt) / 1000;
    const events: TrackingEvent[] = [];

    for (const [index, step] of STEPS.entries()) {
      const dueAfter = index * MOCK_EVENT_INTERVAL_SECONDS;
      if (elapsedSeconds < dueAfter) break;
      events.push({
        type: step.type,
        occurredAt: new Date(bookedAt + dueAfter * 1000),
        description: step.description,
        location: step.location,
      });
    }

    return events;
  }

  /**
   * Every event up to and including `type`, whatever the clock says.
   *
   * What a carrier's webhook means: it is reporting that this happened, not
   * asking whether it is due yet. The timestamps still come from the compressed
   * schedule so the timeline reads in order, but the CUT is the reported event.
   */
  eventsUpTo(
    trackingNumber: string,
    type: TrackingEventType,
    now: Date = new Date(),
  ): TrackingEvent[] {
    const bookedAt = this.bookedAtFrom(trackingNumber);
    if (bookedAt === null) return [];

    const cut = STEPS.findIndex((step) => step.type === type);
    if (cut < 0) return [];

    return STEPS.slice(0, cut + 1).map((step, index) => ({
      type: step.type,
      // Never in the future: a carrier reporting early should not stamp an
      // event after `now`, or the timeline reads as though it has not happened.
      occurredAt: new Date(
        Math.min(bookedAt + index * MOCK_EVENT_INTERVAL_SECONDS * 1000, now.getTime()),
      ),
      description: step.description,
      location: step.location,
    }));
  }

  /** Milliseconds, or null when the number was not minted here. */
  private bookedAtFrom(trackingNumber: string): number | null {
    if (!trackingNumber.startsWith('NM')) return null;
    // Strip the "NM" prefix and the four-character nonce suffix.
    const encoded = trackingNumber.slice(2, -4);
    if (encoded === '') return null;

    const parsed = Number.parseInt(encoded, 36);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}

const STEPS: readonly { type: TrackingEventType; description: string; location: string }[] = [
  {
    type: 'DISPATCHED',
    description: 'Picked up from the seller',
    location: 'Origin warehouse',
  },
  {
    type: 'IN_TRANSIT',
    description: 'Arrived at the sorting hub',
    location: 'Tejgaon hub, Dhaka',
  },
  {
    type: 'OUT_FOR_DELIVERY',
    description: 'Out for delivery with a rider',
    location: 'Local delivery centre',
  },
  {
    type: 'DELIVERED',
    description: 'Delivered',
    location: 'Delivery address',
  },
];
