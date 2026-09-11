import type { OrderEvent, ShipmentView } from '@nexmarket/api-client';
import { describe, expect, it } from 'vitest';
import {
  canAccept,
  canCancel,
  canReject,
  describeEvent,
  describeShipment,
  describeStatus,
  detailForEvent,
  toSteps,
  toneForEvent,
} from './order-timeline.js';

/**
 * THE FRONT-END TEST CONVENTION, chosen here deliberately.
 *
 * `DESIGN-DIRECTION.md` §11 flags that whatever the first screen does becomes
 * the pattern for the whole app, so this is the answer rather than an accident:
 *
 *   - Vitest in the NODE environment. No jsdom, no browser runner.
 *   - Pure view helpers are what gets tested. `apps/web` renders server
 *     components, which a DOM testing library cannot meaningfully drive - so
 *     everything worth asserting is pushed into plain functions over plain
 *     values, and the component keeps only markup.
 *   - No snapshots. A snapshot of markup fails when a class name changes and
 *     passes when the meaning does, which is backwards.
 *   - End-to-end behaviour stays in `apps/api`, against the real server.
 */

const event = (over: Partial<OrderEvent> = {}): OrderEvent => ({
  id: 'e1',
  type: 'PLACED',
  actor: 'BUYER',
  payload: {},
  createdAt: '2026-09-10T10:00:00.000Z',
  ...over,
});

describe('describeEvent', () => {
  it('names a dispatch with its carrier', () => {
    expect(
      describeEvent(
        event({ type: 'SHIPMENT_DISPATCHED', payload: { carrierName: 'Pathao' } }),
        'Bengal Tech',
      ),
    ).toBe('Dispatched with Pathao');
  });

  it('names a dispatch with no carrier, without a dangling preposition', () => {
    expect(describeEvent(event({ type: 'SHIPMENT_DISPATCHED' }), 'Bengal Tech')).toBe('Dispatched');
  });

  it('puts the seller in the sentence rather than "the seller"', () => {
    expect(describeEvent(event({ type: 'ACCEPTED' }), 'Bengal Tech')).toBe(
      'Bengal Tech accepted the order',
    );
    expect(describeEvent(event({ type: 'REJECTED' }), 'Bengal Tech')).toBe(
      'Bengal Tech could not fulfil this order',
    );
  });

  it('still renders a row for an event type it has never heard of', () => {
    // Better than a gap: the buyer learns something happened, which is truer
    // than silence, and the API can add an event before the web app ships.
    expect(describeEvent(event({ type: 'FUTURE_THING' as OrderEvent['type'] }), 'X')).toBe(
      'Order updated',
    );
  });
});

describe('toneForEvent', () => {
  it('leaves the whole normal path uncoloured', () => {
    for (const type of ['PLACED', 'PAID', 'ACCEPTED', 'SHIPMENT_DISPATCHED'] as const) {
      expect(toneForEvent(event({ type }))).toBe('neutral');
    }
  });

  it('colours only what the buyer needs to notice', () => {
    expect(toneForEvent(event({ type: 'SHIPMENT_DELIVERED' }))).toBe('signal');
    expect(toneForEvent(event({ type: 'REJECTED' }))).toBe('warn');
    expect(toneForEvent(event({ type: 'CANCELLED' }))).toBe('warn');
    expect(toneForEvent(event({ type: 'LINES_CANCELLED' }))).toBe('warn');
  });
});

describe('detailForEvent', () => {
  it('surfaces a rejection reason', () => {
    expect(detailForEvent(event({ type: 'REJECTED', payload: { reason: 'Out of stock' } }))).toBe(
      'Out of stock',
    );
  });

  it('surfaces a tracking number when there is no reason', () => {
    expect(
      detailForEvent(event({ type: 'SHIPMENT_DISPATCHED', payload: { trackingNumber: 'PT-42' } })),
    ).toBe('Tracking PT-42');
  });

  it('is null when the step knows nothing extra', () => {
    expect(detailForEvent(event())).toBeNull();
  });

  it('ignores a payload field that is not a string', () => {
    expect(detailForEvent(event({ payload: { reason: 42 } }))).toBeNull();
  });

  it('ignores an empty string rather than rendering a blank line', () => {
    expect(detailForEvent(event({ payload: { reason: '' } }))).toBeNull();
  });
});

describe('toSteps', () => {
  it('keeps the order the API gave and carries every field through', () => {
    const steps = toSteps(
      [
        event({ id: 'a' }),
        event({ id: 'b', type: 'PAID', createdAt: '2026-09-10T10:05:00.000Z' }),
      ],
      'Bengal Tech',
    );
    expect(steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(steps[1]?.label).toBe('Payment received');
    expect(steps[1]?.at).toBe('2026-09-10T10:05:00.000Z');
  });
});

describe('describeShipment', () => {
  const parcel = (over: Partial<ShipmentView> = {}): ShipmentView => ({
    id: 's1',
    shipmentNumber: 'SHP-1',
    status: 'DISPATCHED',
    carrierName: null,
    trackingNumber: null,
    dispatchedAt: '2026-09-10T10:00:00.000Z',
    deliveredAt: null,
    items: [{ orderItemId: 'i1', quantity: 1 }],
    ...over,
  });

  it('counts units across lines rather than counting lines', () => {
    expect(
      describeShipment(
        parcel({
          items: [
            { orderItemId: 'i1', quantity: 2 },
            { orderItemId: 'i2', quantity: 1 },
          ],
        }),
      ),
    ).toBe('3 items');
  });

  it('says "item" for one', () => {
    expect(describeShipment(parcel())).toBe('1 item');
  });

  it('names the carrier when there is one', () => {
    expect(describeShipment(parcel({ carrierName: 'Steadfast' }))).toBe('1 item · Steadfast');
  });
});

describe('canCancel', () => {
  it('allows cancelling only before anything has dispatched', () => {
    expect(canCancel('PENDING_PAYMENT')).toBe(true);
    expect(canCancel('PAID')).toBe(true);
    expect(canCancel('ACCEPTED')).toBe(true);
  });

  it('refuses once a parcel is moving or the order is closed', () => {
    // Mirrors the server's transition table. A button that produces a 409 is
    // worse than no button.
    for (const status of [
      'PARTIALLY_SHIPPED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REJECTED',
    ] as const) {
      expect(canCancel(status)).toBe(false);
    }
  });
});

describe('describeStatus', () => {
  it('speaks the buyer language, never the enum', () => {
    expect(describeStatus('PARTIALLY_SHIPPED').label).toBe('Part shipped');
    expect(describeStatus('REJECTED').label).toBe('Seller declined');
  });

  it('colours only the states that mean something', () => {
    expect(describeStatus('ACCEPTED').tone).toBe('neutral');
    expect(describeStatus('SHIPPED').tone).toBe('neutral');
    expect(describeStatus('DELIVERED').tone).toBe('signal');
    expect(describeStatus('REJECTED').tone).toBe('warn');
  });
});

describe('canAccept', () => {
  it('offers a CASH order that is still awaiting payment', () => {
    // The whole of cash on delivery. The money arrives at the door and the
    // parcel only reaches the door if somebody ships it, so an order that
    // cannot be accepted until it is paid for can never be paid for.
    expect(canAccept('PENDING_PAYMENT', 'cod')).toBe(true);
  });

  it('refuses a CARD order nobody has paid for', () => {
    // Same status, opposite answer, and the payment method is the only thing
    // that separates them. `assertPayableOrCod` is the server-side half.
    expect(canAccept('PENDING_PAYMENT', 'mock')).toBe(false);
  });

  it('offers a paid order regardless of how it was paid', () => {
    expect(canAccept('PAID', 'mock')).toBe(true);
    expect(canAccept('PAID', 'cod')).toBe(true);
  });

  it('offers nothing once the order has moved on', () => {
    for (const status of [
      'ACCEPTED',
      'PARTIALLY_SHIPPED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'REJECTED',
    ] as const) {
      expect(canAccept(status, 'cod')).toBe(false);
      expect(canAccept(status, 'mock')).toBe(false);
    }
  });
});

describe('canReject', () => {
  it('is wider than accepting: an unpaid card order can still be turned away', () => {
    // A seller should not have to wait for a payment that may never arrive
    // before declining. The state machine allows it for any payment method,
    // and `reject` carries no payment check to match.
    expect(canReject('PENDING_PAYMENT')).toBe(true);
    expect(canReject('PAID')).toBe(true);
  });

  it('closes once the seller has committed', () => {
    for (const status of [
      'ACCEPTED',
      'PARTIALLY_SHIPPED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'REJECTED',
    ] as const) {
      expect(canReject(status)).toBe(false);
    }
  });
});
