import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';

export type OrderEventType =
  | 'PLACED'
  | 'PAID'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SHIPMENT_DISPATCHED'
  | 'SHIPMENT_DELIVERED'
  | 'LINES_CANCELLED'
  | 'CANCELLED';

export type EventActor = 'BUYER' | 'SELLER' | 'SYSTEM';

export type TimelineEntry = {
  id: string;
  type: OrderEventType;
  actor: EventActor;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** The order fields this service needs to attribute an event. */
export type EventTarget = {
  id: string;
  tenantId: string;
  buyerUserId: string;
};

/**
 * The only writer of `order_events`, and it can only ever append.
 *
 * The table has UPDATE and DELETE revoked from `nexmarket_app` (migration
 * 0014), so a service that tried to correct history would get SQLSTATE 42501
 * rather than quietly rewriting what a buyer was told. That is the point: a
 * timeline that can be edited is not a timeline.
 *
 * `tenant_id` and `buyer_user_id` are both denormalised off the order, which is
 * what lets RLS govern this table without a join - the seller reads it through
 * `tenant_isolation`, the buyer through `own_order_events`.
 */
@Injectable()
export class OrderEventsService {
  async record(
    tx: Transaction,
    order: EventTarget,
    event: {
      type: OrderEventType;
      actor: EventActor;
      actorUserId: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.insert(schema.orderEvents).values({
      tenantId: order.tenantId,
      orderId: order.id,
      buyerUserId: order.buyerUserId,
      type: event.type,
      actor: event.actor,
      actorUserId: event.actorUserId,
      payload: event.payload ?? {},
    });
  }

  /**
   * One order's timeline, oldest first.
   *
   * Ordered by `(created_at, id)` like every other list in this codebase: two
   * events written in the same millisecond - an acceptance and its dispatch in
   * one transaction, say - would otherwise swap places between requests and
   * make the buyer's history appear to reorder itself.
   */
  async forOrder(tx: Transaction, orderId: string): Promise<TimelineEntry[]> {
    const rows = await tx
      .select({
        id: schema.orderEvents.id,
        type: schema.orderEvents.type,
        actor: schema.orderEvents.actor,
        payload: schema.orderEvents.payload,
        createdAt: schema.orderEvents.createdAt,
      })
      .from(schema.orderEvents)
      .where(eq(schema.orderEvents.orderId, orderId))
      .orderBy(asc(schema.orderEvents.createdAt), asc(schema.orderEvents.id));

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actor: row.actor,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
    }));
  }
}
