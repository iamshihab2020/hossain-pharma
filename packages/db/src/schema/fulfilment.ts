import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { orderItems, orders } from './orders.js';
import { users } from './users.js';

/**
 * TENANT-OWNED, all three. Migration 0014 puts ENABLE + FORCE + policies on
 * each, in the shape 0012 established: `tenant_isolation`,
 * `platform_admin_bypass`, and a buyer-side SELECT policy GATED on no tenant
 * being selected.
 *
 * The gate is the whole of it. Postgres ORs permissive policies, so an ungated
 * buyer policy makes every tenant-scoped read return other sellers' rows as
 * well. That bug has now been fixed three times - org_members (0006), listings
 * (0008), orders (0012) - and these three tables are its next three chances.
 */

export const shipmentStatus = pgEnum('shipment_status', ['DISPATCHED', 'DELIVERED']);

export const orderEventType = pgEnum('order_event_type', [
  'PLACED',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'SHIPMENT_DISPATCHED',
  'SHIPMENT_DELIVERED',
  'LINES_CANCELLED',
  'CANCELLED',
]);

export const orderEventActor = pgEnum('order_event_actor', ['BUYER', 'SELLER', 'SYSTEM']);

/**
 * A parcel.
 *
 * **Creating one IS the dispatch.** There is no DRAFT state: a draft shipment is
 * a picking list, nobody has asked for one, and a state whose only function is
 * to be left behind is a state every query has to remember to exclude.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Human-facing, per seller, like `orders.order_number`. */
    shipmentNumber: text('shipment_number').notNull(),
    status: shipmentStatus('status').notNull().default('DISPATCHED'),

    /** Nullable: a seller may hand a parcel to a rider with neither. */
    carrierName: text('carrier_name'),
    trackingNumber: text('tracking_number'),

    /**
     * What this shipment POSTED to the ledger.
     *
     * Stored, not recomputed on read. The entries it produced are append-only,
     * so a column that could disagree with them after a rounding change would
     * make the books arguable. This is the opposite of the available_stock rule
     * and for the same underlying reason: there the inventory rows are the
     * truth and the column is a cache, whereas here THIS ROW is the truth.
     */
    releaseAmount: bigint('release_amount', { mode: 'number' }).notNull(),
    releaseCommission: bigint('release_commission', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    /**
     * Idempotency is a unique constraint, never a prior lookup - the Phase 4
     * rule. A retried dispatch that ships one parcel twice is real money.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shipments_number_key').on(t.shipmentNumber),
    unique('shipments_idempotency_key').on(t.idempotencyKey),
    check(
      'shipments_release_non_negative',
      sql`${t.releaseAmount} >= 0 AND ${t.releaseCommission} >= 0`,
    ),
    check('shipments_commission_within_release', sql`${t.releaseCommission} <= ${t.releaseAmount}`),
    index('shipments_tenant_idx').on(t.tenantId),
    index('shipments_order_idx').on(t.orderId),
  ],
);

/**
 * Which units of which line went into a parcel.
 *
 * `SUM(quantity)` per order item IS the shipped quantity - there is no
 * `order_items.shipped_quantity`, deliberately. See the note on
 * `cancelled_quantity`.
 */
export const shipmentItems = pgTable(
  'shipment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalised so RLS governs this table without joining two levels up. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    /**
     * RESTRICT for the reason `order_items.listing_id` is: this row is the
     * evidence of what was sent.
     */
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('shipment_items_quantity_positive', sql`${t.quantity} > 0`),
    index('shipment_items_tenant_idx').on(t.tenantId),
    index('shipment_items_shipment_idx').on(t.shipmentId),
    index('shipment_items_order_item_idx').on(t.orderItemId),
  ],
);

/**
 * The buyer's timeline.
 *
 * A status column has no history, and a timeline IS history. `payload` carries
 * the shipment id, the carrier, the cancelled quantities, the rejection reason
 * - whatever the type needs - because a timeline entry that says only SHIPPED
 * is a worse answer than the one the buyer already has.
 *
 * APPEND-ONLY, and migration 0014's REVOKE is what makes it so. Migration 0001
 * ran ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE, so
 * this table already carries all four and a narrower GRANT would read like a
 * restriction while removing nothing. ADR 0016 paid for that lesson.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /**
     * Denormalised so the buyer's policy is a column comparison rather than an
     * EXISTS through orders. `order_items` uses the EXISTS form; this table is
     * read on every timeline render, which is the buyer's most-visited
     * authenticated page.
     */
    buyerUserId: uuid('buyer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    type: orderEventType('type').notNull(),
    actor: orderEventActor('actor').notNull(),
    /** Null for SYSTEM, and SET NULL rather than RESTRICT: a deleted account
     * must not take the order's history with it. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('order_events_tenant_idx').on(t.tenantId),
    /** The timeline pages on (created_at, id), like every other list. */
    index('order_events_order_created_idx').on(t.orderId, t.createdAt, t.id),
    index('order_events_buyer_idx').on(t.buyerUserId),
  ],
);
