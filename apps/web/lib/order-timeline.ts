import type { OrderEvent, OrderStatus, ShipmentView } from '@nexmarket/api-client';

/**
 * The buyer's timeline, as data the component only has to lay out.
 *
 * Pure on purpose. `apps/web` renders server components, which cannot be
 * meaningfully driven by a DOM testing library - so the convention this file
 * establishes is that anything worth asserting lives here, in plain functions
 * over plain values, and the component is left with markup. See
 * `order-timeline.test.ts`.
 */

/**
 * What colour means, and it only ever means something.
 *
 * `neutral` is the whole normal path: placed, paid, accepted, dispatched. A
 * buyer walking an order that is going fine should see no colour at all, which
 * is what makes the two that are coloured readable at a glance.
 */
export type Tone = 'neutral' | 'signal' | 'warn';

export type TimelineStep = {
  id: string;
  label: string;
  /** Carrier, tracking number, reason - whatever the step actually knows. */
  detail: string | null;
  tone: Tone;
  at: string;
};

const REASON_KEY = 'reason';

export function describeEvent(event: OrderEvent, sellerName: string): string {
  switch (event.type) {
    case 'PLACED':
      return 'Order placed';
    case 'PAID':
      return 'Payment received';
    case 'ACCEPTED':
      return `${sellerName} accepted the order`;
    case 'REJECTED':
      return `${sellerName} could not fulfil this order`;
    case 'SHIPMENT_DISPATCHED':
      return carrierOf(event) === null ? 'Dispatched' : `Dispatched with ${carrierOf(event)}`;
    case 'SHIPMENT_DELIVERED':
      return 'Delivered';
    case 'LINES_CANCELLED':
      return 'Some items were cancelled';
    case 'CANCELLED':
      return 'Order cancelled';
    default:
      // A type the client has not learned yet still gets a row rather than a
      // gap: the buyer knows something happened, which is truer than silence.
      return 'Order updated';
  }
}

export function toneForEvent(event: OrderEvent): Tone {
  if (event.type === 'REJECTED' || event.type === 'CANCELLED' || event.type === 'LINES_CANCELLED') {
    return 'warn';
  }
  if (event.type === 'SHIPMENT_DELIVERED') return 'signal';
  return 'neutral';
}

/**
 * The second line under a step, or nothing.
 *
 * A tracking number is the single most useful string on this page once a parcel
 * is moving, and a rejection without its reason tells the buyer less than the
 * seller knew.
 */
export function detailForEvent(event: OrderEvent): string | null {
  const reason = stringField(event, REASON_KEY);
  if (reason !== null) return reason;

  const tracking = stringField(event, 'trackingNumber');
  if (tracking !== null) return `Tracking ${tracking}`;

  return null;
}

export function toSteps(events: readonly OrderEvent[], sellerName: string): TimelineStep[] {
  return events.map((event) => ({
    id: event.id,
    label: describeEvent(event, sellerName),
    detail: detailForEvent(event),
    tone: toneForEvent(event),
    at: event.createdAt,
  }));
}

/** What a parcel is called on the page, and what it is carrying. */
export function describeShipment(shipment: ShipmentView): string {
  const units = shipment.items.reduce((total, item) => total + item.quantity, 0);
  const noun = units === 1 ? 'item' : 'items';
  if (shipment.carrierName === null) return `${String(units)} ${noun}`;
  return `${String(units)} ${noun} · ${shipment.carrierName}`;
}

/**
 * Whether the buyer can still stop this order.
 *
 * Mirrors the transition table in @nexmarket/shared rather than guessing: the
 * server refuses anything else with a 409, and a button that produces an error
 * is worse than no button.
 */
export function canCancel(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAID' || status === 'ACCEPTED';
}

/** Status as a buyer reads it. Never the enum. */
export function describeStatus(status: OrderStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'PENDING_PAYMENT':
      return { label: 'Awaiting payment', tone: 'warn' };
    case 'PAID':
      return { label: 'Paid', tone: 'signal' };
    case 'ACCEPTED':
      return { label: 'Accepted', tone: 'neutral' };
    case 'REJECTED':
      return { label: 'Seller declined', tone: 'warn' };
    case 'PARTIALLY_SHIPPED':
      return { label: 'Part shipped', tone: 'neutral' };
    case 'SHIPPED':
      return { label: 'Shipped', tone: 'neutral' };
    case 'DELIVERED':
      return { label: 'Delivered', tone: 'signal' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'neutral' };
    default:
      return { label: 'Updated', tone: 'neutral' };
  }
}

function carrierOf(event: OrderEvent): string | null {
  return stringField(event, 'carrierName');
}

function stringField(event: OrderEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
