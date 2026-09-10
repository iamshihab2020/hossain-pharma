import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql, sum } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import {
  InvalidTransitionError,
  type OrderStatus,
  assertTransition,
  money,
  releaseEntries,
  reversalEntries,
  shareFor,
  statusFromCoverage,
  unitShares,
} from '@nexmarket/shared';
import { getRequestContext } from '../../common/request-context.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { OrdersService, type OrderView } from '../orders/orders.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import type { CreateShipmentInput } from './dto.js';
import { OrderEventsService, type EventActor } from './order-events.service.js';

/** One order line, with everything the coverage arithmetic needs. */
type Line = {
  id: string;
  listingId: string;
  quantity: number;
  cancelledQuantity: number;
  shippedQuantity: number;
  unitPriceAmount: number;
};

type LoadedOrder = {
  id: string;
  tenantId: string;
  buyerUserId: string;
  paymentIntentId: string;
  status: OrderStatus;
  totalAmount: number;
  commissionAmount: number;
  currency: string;
  lines: Line[];
};

type CancelPick = { orderItemId: string; quantity: number };

export type ShipmentView = {
  id: string;
  orderId: string;
  shipmentNumber: string;
  status: 'DISPATCHED' | 'DELIVERED';
  carrierName: string | null;
  trackingNumber: string | null;
  released: { amount: number; currency: string };
  commission: { amount: number; currency: string };
  dispatchedAt: Date;
  deliveredAt: Date | null;
  items: { orderItemId: string; quantity: number }[];
};

/** A replayed idempotency key returns the ORIGINAL parcel, never a second one. */
export type DispatchResult = { shipment: ShipmentView; created: boolean };

/**
 * The write half of an order's life: accept, reject, dispatch, deliver, cancel.
 *
 * Two rules hold throughout and are worth stating once rather than at every
 * method:
 *
 *   - **No method sets a status.** Callers accept, ship or cancel, and
 *     `statusFromCoverage` decides what the order now is. That is what keeps
 *     `orders.status` from disagreeing with `shipment_items`, since only one of
 *     the two can be recomputed from the other.
 *   - **Nothing here filters by tenant.** `orders`, `order_items`, `shipments`
 *     and `order_events` are all governed by RLS, and an application `WHERE
 *     tenant_id` would produce correct answers while masking a policy
 *     regression - the same argument `OrdersService` makes at length.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly ledger: LedgerService,
    private readonly listings: ListingsService,
    private readonly search: SearchIndexService,
  ) {}

  /** The seller takes the order on. */
  async accept(orderId: string): Promise<OrderView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    this.assertAllowed(order.status, 'ACCEPTED', 'SELLER');

    await tx
      .update(schema.orders)
      .set({ status: 'ACCEPTED', updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    await this.events.record(tx, order, {
      type: 'ACCEPTED',
      actor: 'SELLER',
      actorUserId: userId,
    });

    return this.orders.forSellerOne(orderId);
  }

  /**
   * The seller declines before accepting.
   *
   * REJECTED rather than CANCELLED, deliberately: a buyer reading their history
   * must be able to tell "I cancelled this" from "the seller would not fulfil
   * it" without reading an event log, and Phase 7 wants a rejection rate.
   *
   * Everything else is a cancellation of every line - the stock goes back, the
   * buyer is owed - so it runs the same code, and only the terminal status
   * differs.
   */
  async reject(orderId: string, reason: string): Promise<OrderView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    this.assertAllowed(order.status, 'REJECTED', 'SELLER');

    await this.cancelLines(tx, order, outstandingOf(order), {
      actor: 'SELLER',
      actorUserId: userId,
      reason,
      eventType: 'REJECTED',
      finalStatus: 'REJECTED',
    });

    return this.orders.forSellerOne(orderId);
  }


  /**
   * Dispatch: the parcel leaves, and the seller's money leaves clearing.
   *
   * The order of operations is the design, and each step is here for a reason:
   *
   *   1. idempotency FIRST, decided by a unique constraint rather than a prior
   *      SELECT that two concurrent retries would both pass;
   *   2. the units are claimed under a row lock, because the shipped counter
   *      lives in another table and so cannot be a conditional UPDATE;
   *   3. the ledger releases exactly those units' allocated share - this is
   *      where a seller first becomes owed anything at all;
   *   4. stock leaves the shelf AND its reservation together, so what a buyer
   *      can buy is unchanged and no reindex is needed;
   *   5. the status is recomputed from coverage, never set.
   */
  async createShipment(orderId: string, input: CreateShipmentInput): Promise<DispatchResult> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);

    // ACCEPTED or PARTIALLY_SHIPPED may ship; anything else is a 409. SHIPPED
    // is the target asked about because a parcel that completes the order lands
    // there - which of the two it actually was is statusFromCoverage's call.
    this.assertAllowed(order.status, 'SHIPPED', 'SELLER');

    const existing = await this.shipmentByKey(tx, input.idempotencyKey);
    if (existing !== null) return { shipment: existing, created: false };

    const byId = new Map(order.lines.map((line) => [line.id, line]));
    for (const pick of input.items) {
      if (!byId.has(pick.orderItemId)) {
        throw new NotFoundException(`Order item ${pick.orderItemId} is not on this order`);
      }
      await this.claimUnits(tx, pick);
    }

    const share = shareFor(this.sharesFor(order), consumedOf(order), input.items);

    const [row] = await tx
      .insert(schema.shipments)
      .values({
        tenantId: order.tenantId,
        orderId: order.id,
        shipmentNumber: shipmentNumber(),
        carrierName: input.carrierName ?? null,
        trackingNumber: input.trackingNumber ?? null,
        releaseAmount: share.total.amount,
        releaseCommission: share.commission.amount,
        currency: share.total.currency,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    if (row === undefined) throw new ConflictException('Shipment could not be created');

    await tx.insert(schema.shipmentItems).values(
      input.items.map((pick) => ({
        tenantId: order.tenantId,
        shipmentId: row.id,
        orderItemId: pick.orderItemId,
        quantity: pick.quantity,
      })),
    );

    await this.ledger.post(tx, {
      paymentIntentId: order.paymentIntentId,
      kind: 'FULFILMENT',
      entries: releaseEntries(order.tenantId, share),
    });

    for (const pick of input.items) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) continue;
      await this.dispatchStock(tx, line.listingId, pick.quantity);
      // NO reindex here, and that is not an oversight. on_hand and reserved
      // fall TOGETHER, so `available = on_hand - reserved` is unchanged: the
      // goods left the shelf and left their reservation at the same moment, and
      // what a buyer can buy did not move. The recompute still runs, because
      // available_stock caches that difference and one writer owns it.
      await this.listings.recomputeAvailableStock(tx, line.listingId);
    }

    const shipped = applyShipments(order, input.items);
    await tx
      .update(schema.orders)
      .set({ status: statusFromCoverage(coverageOf(shipped), order.status), updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));

    await this.events.record(tx, order, {
      type: 'SHIPMENT_DISPATCHED',
      actor: 'SELLER',
      actorUserId: userId,
      payload: {
        shipmentId: row.id,
        shipmentNumber: row.shipmentNumber,
        ...(input.carrierName === undefined ? {} : { carrierName: input.carrierName }),
        ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
        items: input.items,
        released: { amount: share.total.amount, currency: share.total.currency },
      },
    });

    return { shipment: toShipmentView(row, input.items), created: true };
  }


  /**
   * The parcel arrived.
   *
   * NO LEDGER POSTING, and this is the obvious place to come looking for one.
   * The money moved at DISPATCH - see `releaseEntries` - so delivery changes
   * nothing about who is owed what. When Phase 6 replaces this button with
   * carrier tracking events, the trigger changes and this stays empty.
   *
   * The ORDER becomes DELIVERED only when no parcel is still in transit and no
   * unit is still outstanding: a seller who has shipped half and delivered that
   * half has not delivered the order.
   */
  async markDelivered(orderId: string, shipmentId: string): Promise<ShipmentView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);

    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.orderId, orderId)))
      .limit(1);
    const parcel = rows[0];
    // A 404, not a 403: under RLS a parcel that is not yours does not exist.
    if (parcel === undefined) throw new NotFoundException('No such shipment');
    if (parcel.status === 'DELIVERED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        from: 'DELIVERED',
        to: 'DELIVERED',
        message: 'That parcel is already marked delivered',
      });
    }

    const delivered = new Date();
    await tx
      .update(schema.shipments)
      .set({ status: 'DELIVERED', deliveredAt: delivered, updatedAt: delivered })
      .where(eq(schema.shipments.id, shipmentId));

    const inTransit = await tx
      .select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.status, 'DISPATCHED')));

    const outstanding = outstandingOf(order).length;
    if (inTransit.length === 0 && outstanding === 0) {
      this.assertAllowed(order.status, 'DELIVERED', 'SELLER');
      await tx
        .update(schema.orders)
        .set({ status: 'DELIVERED', updatedAt: delivered })
        .where(eq(schema.orders.id, orderId));
    }

    await this.events.record(tx, order, {
      type: 'SHIPMENT_DELIVERED',
      actor: 'SELLER',
      actorUserId: userId,
      payload: { shipmentId, shipmentNumber: parcel.shipmentNumber },
    });

    const items = await tx
      .select({
        orderItemId: schema.shipmentItems.orderItemId,
        quantity: schema.shipmentItems.quantity,
      })
      .from(schema.shipmentItems)
      .where(eq(schema.shipmentItems.shipmentId, shipmentId));

    return toShipmentView(
      { ...parcel, status: 'DELIVERED', deliveredAt: delivered },
      items,
    );
  }

  // ---------------------------------------------------------------- internals



  /**
   * Cancels units, and is the ONE place that does.
   *
   * Three things happen together and must not be separated:
   *
   *   1. the units are marked cancelled, guarded so a shipped unit cannot be
   *      cancelled out from under a courier;
   *   2. the ledger reverses exactly those units' allocated share, because the
   *      buyer is owed them from this moment. No seller entry - a seller is
   *      credited on DISPATCH, so nothing was ever credited for units that did
   *      not go;
   *   3. the reservation is released, which INCREASES what a buyer can buy and
   *      therefore must reindex.
   */
  private async cancelLines(
    tx: Transaction,
    order: LoadedOrder,
    picks: CancelPick[],
    how: {
      actor: EventActor;
      actorUserId: string | null;
      reason: string | undefined;
      eventType: 'REJECTED' | 'CANCELLED' | 'LINES_CANCELLED';
      finalStatus?: OrderStatus;
    },
  ): Promise<void> {
    if (picks.length === 0) {
      throw new ConflictException('Nothing left to cancel on this order');
    }

    const byId = new Map(order.lines.map((line) => [line.id, line]));
    for (const pick of picks) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) {
        throw new NotFoundException(`Order item ${pick.orderItemId} is not on this order`);
      }

      // The ADR 0017 shape: the predicate lives INSIDE the FOR UPDATE subquery
      // and is REPEATED outside, because Postgres re-checks only the outer
      // WHERE after taking the lock. The deferred constraint trigger from
      // migration 0014 is the backstop underneath.
      const updated = await tx.execute(sql`
        UPDATE order_items
           SET cancelled_quantity = cancelled_quantity + ${pick.quantity}
         WHERE id = (
           SELECT oi.id FROM order_items oi
            WHERE oi.id = ${pick.orderItemId}
              AND oi.quantity - oi.cancelled_quantity - ${line.shippedQuantity} >= ${pick.quantity}
            FOR UPDATE
         )
           AND quantity - cancelled_quantity - ${line.shippedQuantity} >= ${pick.quantity}
        RETURNING id
      `);
      if ((updated.rowCount ?? 0) === 0) {
        throw new ConflictException(
          `Only ${line.quantity - line.cancelledQuantity - line.shippedQuantity} unit(s) of that line can still be cancelled`,
        );
      }
    }

    const share = shareFor(this.sharesFor(order), consumedOf(order), picks);
    await this.ledger.post(tx, {
      paymentIntentId: order.paymentIntentId,
      kind: 'REFUND',
      entries: reversalEntries(share),
    });

    for (const pick of picks) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) continue;
      await this.release(tx, line.listingId, pick.quantity);
      // A write that changes what a buyer would FIND must reindex, and putting
      // the last unit back does exactly that: `in_stock`, `min_price_amount`
      // and `seller_count` all derive from eligible offers. The recompute goes
      // through ListingsService because that class is the single documented
      // writer of `listings.available_stock`.
      await this.listings.recomputeAvailableStock(tx, line.listingId);
      await this.search.reindexForListing(tx, line.listingId);
    }

    const applied = applyCancellations(order, picks);
    const status = how.finalStatus ?? statusFromCoverage(coverageOf(applied), order.status);

    await tx
      .update(schema.orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));

    await this.events.record(tx, order, {
      type: how.eventType,
      actor: how.actor,
      actorUserId: how.actorUserId,
      payload: {
        ...(how.reason === undefined ? {} : { reason: how.reason }),
        items: picks,
        reversed: { amount: share.total.amount, currency: share.total.currency },
      },
    });
  }

  /**
   * Puts a reservation back.
   *
   * Same both-halves shape as the reserve it undoes: the predicate is inside
   * the locked subquery and repeated outside. Without it two concurrent
   * cancellations could drive `reserved` below zero, which the CHECK from
   * migration 0008 would then turn into a 500 rather than a clean refusal.
   */
  private async release(tx: Transaction, listingId: string, quantity: number): Promise<void> {
    const updated = await tx.execute(sql`
      UPDATE inventory_items
         SET reserved = reserved - ${quantity}, updated_at = now()
       WHERE id = (
         SELECT id FROM inventory_items
          WHERE listing_id = ${listingId} AND reserved >= ${quantity}
          ORDER BY reserved DESC
          LIMIT 1
          FOR UPDATE
       )
         AND reserved >= ${quantity}
      RETURNING id
    `);
    if ((updated.rowCount ?? 0) === 0) {
      throw new ConflictException('Inventory reservation could not be released');
    }
  }


  /**
   * Takes `pick.quantity` units of a line, or refuses.
   *
   * A row lock rather than the conditional UPDATE the reservation uses, and the
   * difference is forced: the shipped counter is SUM(shipment_items.quantity)
   * in ANOTHER table, so there is no single row whose predicate could be
   * re-checked after the lock. Locking the parent line serialises every
   * dispatch of it instead, and the count that follows is a separate statement,
   * so under READ COMMITTED it sees whatever the transaction ahead of it
   * committed rather than a pre-lock snapshot.
   *
   * The deferred trigger from migration 0014 is the backstop underneath, and it
   * is what makes this safe rather than merely careful.
   */
  private async claimUnits(tx: Transaction, pick: CancelPick): Promise<void> {
    await tx.execute(sql`SELECT id FROM order_items WHERE id = ${pick.orderItemId} FOR UPDATE`);

    const remaining = await tx.execute<{ remaining: number }>(sql`
      SELECT oi.quantity - oi.cancelled_quantity - COALESCE((
               SELECT SUM(si.quantity)::int FROM shipment_items si
                WHERE si.order_item_id = oi.id
             ), 0) AS remaining
        FROM order_items oi
       WHERE oi.id = ${pick.orderItemId}
    `);

    const left = remaining.rows[0]?.remaining ?? 0;
    if (left < pick.quantity) {
      throw new ConflictException(
        `Only ${left} unit(s) of that line are left to ship, and ${pick.quantity} were picked`,
      );
    }
  }

  /**
   * Goods leave the building: on_hand AND reserved both fall.
   *
   * Both, or `available` moves and the buy box starts advertising stock that has
   * already been posted. Same both-halves guard as every other inventory write.
   */
  private async dispatchStock(tx: Transaction, listingId: string, quantity: number): Promise<void> {
    const updated = await tx.execute(sql`
      UPDATE inventory_items
         SET on_hand = on_hand - ${quantity},
             reserved = reserved - ${quantity},
             updated_at = now()
       WHERE id = (
         SELECT id FROM inventory_items
          WHERE listing_id = ${listingId} AND reserved >= ${quantity} AND on_hand >= ${quantity}
          ORDER BY reserved DESC
          LIMIT 1
          FOR UPDATE
       )
         AND reserved >= ${quantity} AND on_hand >= ${quantity}
      RETURNING id
    `);
    if ((updated.rowCount ?? 0) === 0) {
      throw new ConflictException('No reserved stock to dispatch for that listing');
    }
  }

  /** The parcel this key already made, if it made one. */
  private async shipmentByKey(tx: Transaction, key: string): Promise<ShipmentView | null> {
    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.idempotencyKey, key))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    const items = await tx
      .select({
        orderItemId: schema.shipmentItems.orderItemId,
        quantity: schema.shipmentItems.quantity,
      })
      .from(schema.shipmentItems)
      .where(eq(schema.shipmentItems.shipmentId, row.id));

    return toShipmentView(row, items);
  }

  /** The order total and commission, split across the order's individual units. */
  private sharesFor(order: LoadedOrder) {
    return unitShares(
      money(order.totalAmount, order.currency),
      money(order.commissionAmount, order.currency),
      order.lines.map((line) => ({
        orderItemId: line.id,
        quantity: line.quantity,
        unitPriceAmount: line.unitPriceAmount,
      })),
    );
  }

  /**
   * A 409 with a code, not a 500.
   *
   * There is no exception filter to hang this on - `checkout.service.ts` throws
   * its PRICE_CHANGED conflict inline the same way - and the client's correct
   * response to both is to re-render rather than retry.
   */
  private assertAllowed(from: OrderStatus, to: OrderStatus, actor: EventActor): void {
    try {
      assertTransition(from, to, actor);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new ConflictException({ code: 'INVALID_TRANSITION', from, to, message: error.message });
      }
      throw error;
    }
  }

  /**
   * The order, its lines, and how much of each has already gone or been lost.
   *
   * Shipped quantity is summed from `shipment_items` rather than read from a
   * column, because a denormalised counter here would have two writers -
   * dispatch and cancellation - and drift under concurrency.
   */
  private async load(tx: Transaction, orderId: string): Promise<LoadedOrder> {
    const rows = await tx
      .select({
        id: schema.orders.id,
        tenantId: schema.orders.tenantId,
        buyerUserId: schema.orders.buyerUserId,
        paymentIntentId: schema.orders.paymentIntentId,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        commissionAmount: schema.orders.commissionAmount,
        currency: schema.orders.currency,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    // A 404, not a 403. Under RLS an order that is not yours does not exist,
    // and saying "forbidden" would confirm that it does.
    if (order === undefined) throw new NotFoundException('No such order');

    const lines = await tx
      .select({
        id: schema.orderItems.id,
        listingId: schema.orderItems.listingId,
        quantity: schema.orderItems.quantity,
        cancelledQuantity: schema.orderItems.cancelledQuantity,
        unitPriceAmount: schema.orderItems.unitPriceAmount,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    /**
     * Shipped quantity as its OWN grouped query, never a correlated subquery in
     * the select list above.
     *
     * ADR 0010, and this cost an afternoon a second time before the note was
     * believed: Drizzle renders column references inside a `sql` template in the
     * SELECT list WITHOUT table qualification, so
     * `WHERE si.order_item_id = ${schema.orderItems.id}` becomes
     * `WHERE si.order_item_id = "id"` - which resolves to shipment_items' OWN
     * id, compares the table to itself, is always false, and raises nothing.
     * Every line reported zero shipped units, so a completed order stayed
     * PARTIALLY_SHIPPED and every parcel re-allocated the same unit shares.
     */
    const ids = lines.map((line) => line.id);
    const shippedByLine = new Map<string, number>();
    if (ids.length > 0) {
      const sums = await tx
        .select({
          orderItemId: schema.shipmentItems.orderItemId,
          shipped: sum(schema.shipmentItems.quantity),
        })
        .from(schema.shipmentItems)
        .where(inArray(schema.shipmentItems.orderItemId, ids))
        .groupBy(schema.shipmentItems.orderItemId);
      for (const row of sums) {
        shippedByLine.set(row.orderItemId, Number(row.shipped ?? 0));
      }
    }

    return {
      ...order,
      lines: lines.map((line) => ({
        id: line.id,
        listingId: line.listingId,
        quantity: line.quantity,
        cancelledQuantity: line.cancelledQuantity,
        shippedQuantity: shippedByLine.get(line.id) ?? 0,
        unitPriceAmount: line.unitPriceAmount,
      })),
    };
  }
}

/** Every unit that has neither shipped nor been cancelled. */
function outstandingOf(order: LoadedOrder): CancelPick[] {
  return order.lines
    .map((line) => ({
      orderItemId: line.id,
      quantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
    }))
    .filter((pick) => pick.quantity > 0);
}

/**
 * How many units of each line are already spoken for.
 *
 * `shipped + cancelled`, which is exactly the index of the line's next free
 * unit - the order in which `shareFor` consumes them.
 */
function consumedOf(order: LoadedOrder): Map<string, number> {
  return new Map(
    order.lines.map((line) => [line.id, line.shippedQuantity + line.cancelledQuantity]),
  );
}

function applyCancellations(order: LoadedOrder, picks: CancelPick[]): LoadedOrder {
  const extra = new Map(picks.map((pick) => [pick.orderItemId, pick.quantity]));
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      cancelledQuantity: line.cancelledQuantity + (extra.get(line.id) ?? 0),
    })),
  };
}

function applyShipments(order: LoadedOrder, picks: CancelPick[]): LoadedOrder {
  const extra = new Map(picks.map((pick) => [pick.orderItemId, pick.quantity]));
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      shippedQuantity: line.shippedQuantity + (extra.get(line.id) ?? 0),
    })),
  };
}

function toShipmentView(
  row: typeof schema.shipments.$inferSelect,
  items: { orderItemId: string; quantity: number }[],
): ShipmentView {
  return {
    id: row.id,
    orderId: row.orderId,
    shipmentNumber: row.shipmentNumber,
    status: row.status,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    released: { amount: row.releaseAmount, currency: row.currency },
    commission: { amount: row.releaseCommission, currency: row.currency },
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
    items,
  };
}

/** Same shape as `orderNumber` in checkout: human-facing, per seller, unique. */
function shipmentNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `SHP-${stamp}-${noise}`;
}

function coverageOf(order: LoadedOrder) {
  return order.lines.map((line) => ({
    ordered: line.quantity,
    shipped: line.shippedQuantity,
    cancelled: line.cancelledQuantity,
  }));
}
