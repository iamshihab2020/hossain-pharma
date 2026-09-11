import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { canTransition, type OrderStatus } from '@nexmarket/shared';
import { OrderEventsService, type OrderEventType } from '../fulfilment/order-events.service.js';
import { MockCarrierAdapter } from './mock-carrier.adapter.js';
import type { TrackingEvent, TrackingEventType } from './shipping-provider.port.js';

export type TrackingOutcome = { applied: boolean; reason: string; applied_events?: number };

/**
 * Carrier tracking events, applied to a parcel and through it to an order.
 *
 * PRD 11 Phase 6: "a time-compressed mock adapter emitting realistic tracking
 * events" and "mock tracking emits a full event timeline".
 *
 * LIKE THE PAYMENT WEBHOOK, this runs as the PLATFORM - no tenant, no user.
 * A carrier holds no NexMarket session, and the parcel it is reporting on
 * belongs to a seller it has never heard of. With no tenant selected,
 * `tenant_isolation` matches nothing and the update would silently affect zero
 * rows, which is the worst possible outcome: a 200 and no change. The webhook is
 * authenticated by an HMAC over the body and the only caller-influenced value
 * that reaches a query is the tracking number, which selects one parcel.
 */
@Injectable()
export class TrackingService {
  private readonly log = new Logger(TrackingService.name);

  constructor(
    private readonly carrier: MockCarrierAdapter,
    private readonly events: OrderEventsService,
  ) {}

  /**
   * Applies every event the carrier has recorded for a tracking number.
   *
   * REPLAY-SAFE BY COMPARISON, not by a dedupe table. Each event maps to a
   * shipment status, the statuses are totally ordered, and an event that is not
   * *ahead* of where the parcel already is does nothing. So a carrier that
   * retries, or delivers three webhooks out of order, converges on the same
   * state - which is what "idempotent" has to mean when the sender is somebody
   * else's retry loop.
   *
   * That is a different mechanism from the payment webhook's unique index, and
   * deliberately so: money is not idempotent under comparison (two captures of
   * ৳100 are not one capture of ৳100), but a parcel's position is. Applying the
   * ledger's rule here would need an event id the carrier does not always send.
   */
  async apply(
    trackingNumber: string,
    upTo?: TrackingEventType,
    now: Date = new Date(),
  ): Promise<TrackingOutcome> {
    /**
     * The carrier SAYS what happened; the schedule is only a fallback.
     *
     * A real webhook body names the event - "out for delivery, 14:02, Mirpur" -
     * and that is the fact being reported. Deriving it from elapsed time
     * instead would mean a carrier could tell us a parcel had arrived and we
     * would answer "not yet, by my clock", which is the wrong way round about
     * whose information this is.
     *
     * The time-compressed schedule still drives the mock when no type is given,
     * so a demo left running walks a parcel through the states on its own.
     */
    const history =
      upTo === undefined
        ? this.carrier.eventsSoFar(trackingNumber, now)
        : /**
           * A NAMED event needs no schedule, and this is where that stops being
           * a comment and starts being behaviour.
           *
           * The mock's history is decoded from the tracking number it minted,
           * so it has nothing to say about a number it did not: a seller who
           * types "PT-9912" into the console and hands the box to a rider owns
           * a parcel this adapter cannot date. That is every parcel dispatched
           * by hand, which is every parcel with a console behind it.
           *
           * Refusing those was the paragraph above contradicting itself - the
           * carrier told us where the parcel is, and we answered "no events for
           * that tracking number" about a parcel we can find by that very
           * number, one line further down. So when the carrier names the state
           * and the schedule has nothing, the reported state IS the history.
           */
          orReported(this.carrier.eventsUpTo(trackingNumber, upTo, now), upTo, now);

    if (history.length === 0) {
      return { applied: false, reason: 'no events for that tracking number' };
    }

    return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
      const parcel = await this.findParcel(tx, trackingNumber);
      if (parcel === null) throw new NotFoundException('No such parcel');

      const latest = history[history.length - 1];
      if (latest === undefined) return { applied: false, reason: 'no events' };

      if (RANK[latest.type] <= RANK[parcel.status]) {
        return { applied: false, reason: 'already at or past that state' };
      }

      // Only the events the parcel has not already passed. A parcel found at
      // IN_TRANSIT replays OUT_FOR_DELIVERY and DELIVERED and re-records
      // neither of the two behind it - the timeline is append-only, so a
      // duplicate there is permanent.
      const fresh = history.filter((event) => RANK[event.type] > RANK[parcel.status]);

      await this.advanceParcel(tx, parcel, latest, fresh);
      await this.advanceOrder(tx, parcel, latest);

      return { applied: true, reason: 'ok', applied_events: fresh.length };
    });
  }

  private async findParcel(
    tx: Transaction,
    trackingNumber: string,
  ): Promise<ParcelRow | null> {
    const [row] = await tx
      .select({
        id: schema.shipments.id,
        orderId: schema.shipments.orderId,
        tenantId: schema.shipments.tenantId,
        shipmentNumber: schema.shipments.shipmentNumber,
        status: schema.shipments.status,
        carrierName: schema.shipments.carrierName,
        orderStatus: schema.orders.status,
        buyerUserId: schema.orders.buyerUserId,
      })
      .from(schema.shipments)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
      .where(eq(schema.shipments.trackingNumber, trackingNumber))
      .limit(1);

    return row ?? null;
  }

  private async advanceParcel(
    tx: Transaction,
    parcel: ParcelRow,
    latest: TrackingEvent,
    fresh: readonly TrackingEvent[],
  ): Promise<void> {
    await tx
      .update(schema.shipments)
      .set({
        status: latest.type,
        updatedAt: new Date(),
        ...(latest.type === 'DELIVERED' ? { deliveredAt: latest.occurredAt } : {}),
      })
      .where(eq(schema.shipments.id, parcel.id));

    for (const event of fresh) {
      await this.events.record(
        tx,
        { id: parcel.orderId, tenantId: parcel.tenantId, buyerUserId: parcel.buyerUserId },
        {
          type: EVENT_TYPE[event.type],
          // SYSTEM, always. Nobody decided this; a courier reported it, and the
          // buyer's timeline should not attribute it to their seller.
          actor: 'SYSTEM',
          actorUserId: null,
          payload: {
            shipmentId: parcel.id,
            shipmentNumber: parcel.shipmentNumber,
            carrier: parcel.carrierName,
            description: event.description,
            location: event.location,
            occurredAt: event.occurredAt.toISOString(),
          },
        },
      );
    }
  }

  /**
   * Moves the ORDER, but only when every parcel agrees.
   *
   * An order with two parcels is out for delivery when the LAST one is, not the
   * first - otherwise a buyer sees "out for delivery" while a box is still in a
   * hub, and then watches the status go backwards when it does not arrive.
   * Taking the minimum across parcels is what makes the order's status a
   * statement about the whole order.
   */
  private async advanceOrder(
    tx: Transaction,
    parcel: ParcelRow,
    latest: TrackingEvent,
  ): Promise<void> {
    const behind = await tx
      .select({ status: schema.shipments.status })
      .from(schema.shipments)
      .where(
        and(
          eq(schema.shipments.orderId, parcel.orderId),
          ne(schema.shipments.id, parcel.id),
        ),
      );

    const laggard = behind.some((other) => RANK[other.status] < RANK[latest.type]);
    if (laggard) return;

    /**
     * Outstanding lines keep an order off DELIVERED.
     *
     * Every parcel arriving does not finish an order that still has unshipped
     * units - that order is PARTIALLY_SHIPPED and the remaining units are
     * someone's problem. `statusFromCoverage` owns that rule; here we only
     * refuse to jump past it.
     */
    const target = ORDER_STATUS[latest.type];
    if (target === null) return;
    if (!canTransition(parcel.orderStatus as OrderStatus, target, 'SYSTEM')) {
      this.log.debug(
        `Not moving order ${parcel.orderId} from ${parcel.orderStatus} to ${target}`,
      );
      return;
    }

    await tx
      .update(schema.orders)
      .set({ status: target, updatedAt: new Date() })
      .where(eq(schema.orders.id, parcel.orderId));
  }
}

type ParcelRow = {
  id: string;
  orderId: string;
  tenantId: string;
  shipmentNumber: string;
  status: TrackingEventType;
  carrierName: string | null;
  orderStatus: string;
  buyerUserId: string;
};

/**
 * The total order on parcel states, which is what makes replay safe.
 *
 * A plain number rather than the array index, so that inserting a state later
 * is a deliberate renumbering rather than a silent reordering of everything
 * after it.
 */
/**
 * The carrier's word, when there is no schedule to read.
 *
 * Every state up to and including the reported one, all stamped NOW - because
 * that is honestly all we know. A parcel reported OUT_FOR_DELIVERY certainly
 * passed through a hub, and the timeline should say so rather than jumping; but
 * nobody told us when, and inventing earlier timestamps would put fiction in an
 * append-only log. `apply` records only the states the parcel had not already
 * passed, so a normal sequence of webhooks still writes one entry each.
 */
function orReported(
  scheduled: readonly TrackingEvent[],
  upTo: TrackingEventType,
  now: Date,
): TrackingEvent[] {
  if (scheduled.length > 0) return [...scheduled];

  const cut = RANK[upTo];
  return (Object.keys(RANK) as TrackingEventType[])
    .filter((type) => RANK[type] <= cut)
    .sort((a, b) => RANK[a] - RANK[b])
    .map((type) => ({
      type,
      occurredAt: now,
      description: REPORTED[type],
      location: 'Reported by the carrier',
    }));
}

/** Plain descriptions for a carrier that sent a state and no prose. */
const REPORTED: Record<TrackingEventType, string> = {
  DISPATCHED: 'Picked up from the seller',
  IN_TRANSIT: 'On its way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
};

const RANK: Record<TrackingEventType, number> = {
  DISPATCHED: 0,
  IN_TRANSIT: 1,
  OUT_FOR_DELIVERY: 2,
  DELIVERED: 3,
};

const EVENT_TYPE: Record<TrackingEventType, OrderEventType> = {
  DISPATCHED: 'SHIPMENT_DISPATCHED',
  IN_TRANSIT: 'SHIPMENT_IN_TRANSIT',
  OUT_FOR_DELIVERY: 'SHIPMENT_OUT_FOR_DELIVERY',
  DELIVERED: 'SHIPMENT_DELIVERED',
};

/**
 * Which carrier states move the ORDER, and which are parcel-only.
 *
 * IN_TRANSIT is null on purpose: an order whose parcel reached a sorting hub is
 * still SHIPPED, and adding an order state for it would be PACKED all over
 * again - a status a buyer cannot act on and a seller cannot influence.
 */
const ORDER_STATUS: Record<TrackingEventType, OrderStatus | null> = {
  DISPATCHED: null,
  IN_TRANSIT: null,
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};
