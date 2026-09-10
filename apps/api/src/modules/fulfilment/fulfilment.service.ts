import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import {
  InvalidTransitionError,
  type OrderStatus,
  assertTransition,
  money,
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
        shipped: sql<number>`COALESCE((
          SELECT SUM(si.quantity)::int FROM shipment_items si
           WHERE si.order_item_id = ${schema.orderItems.id}
        ), 0)`,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    return {
      ...order,
      lines: lines.map((line) => ({
        id: line.id,
        listingId: line.listingId,
        quantity: line.quantity,
        cancelledQuantity: line.cancelledQuantity,
        shippedQuantity: Number(line.shipped),
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

function coverageOf(order: LoadedOrder) {
  return order.lines.map((line) => ({
    ordered: line.quantity,
    shipped: line.shippedQuantity,
    cancelled: line.cancelledQuantity,
  }));
}
