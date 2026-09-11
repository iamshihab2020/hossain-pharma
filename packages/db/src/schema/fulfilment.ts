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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { orderItems, orders } from './orders.js';
import { users } from './users.js';
import { warehouses } from './warehouses.js';
import { deliverySlots } from './logistics.js';

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

/**
 * Phase 6 added the two middle states, and only the carrier feed sets them.
 *
 * Phase 5 had DISPATCHED and DELIVERED because a seller can observe both: they
 * handed the box over, and the buyer told them it arrived. IN_TRANSIT and
 * OUT_FOR_DELIVERY are things only a courier knows, which is why they arrive
 * with the adapter that reports them rather than as two more buttons.
 */
export const shipmentStatus = pgEnum('shipment_status', [
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

export const orderEventType = pgEnum('order_event_type', [
  'PLACED',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'SHIPMENT_DISPATCHED',
  // Phase 6: carrier events. SYSTEM actor, always - they are reported, not
  // decided, and the timeline says which by whom.
  'SHIPMENT_IN_TRANSIT',
  'SHIPMENT_OUT_FOR_DELIVERY',
  'SHIPMENT_DELIVERED',
  /** Cash taken at the door, clearing COD_RECEIVABLE. */
  'COD_COLLECTED',
  /** Reverse logistics: a courier booked to come and take it back. */
  'RETURN_PICKUP_SCHEDULED',
  'LINES_CANCELLED',
  'CANCELLED',
]);

export const orderEventActor = pgEnum('order_event_actor', ['BUYER', 'SELLER', 'SYSTEM']);

export const returnPickupStatus = pgEnum('return_pickup_status', [
  'SCHEDULED',
  'COLLECTED',
  'CANCELLED',
]);

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
     * Which building it left, added in Phase 6.
     *
     * Nullable because Phase 5's parcels predate the column and there is no
     * honest way to attribute them after the fact - a backfill to the default
     * warehouse would invent a shipping origin, and the packing slip prints
     * that origin as a return address.
     *
     * SET NULL rather than CASCADE on delete: closing a warehouse must not
     * delete the record of parcels that left it.
     */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),

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
    index('shipments_warehouse_idx').on(t.warehouseId),
    /** The tracking webhook's lookup: find the parcel a carrier is reporting on. */
    index('shipments_tracking_idx').on(t.carrierName, t.trackingNumber),
  ],
);

/**
 * TENANT-OWNED. A courier booked to collect something from a buyer.
 *
 * PRD 11 Phase 6's "reverse logistics (return pickup scheduling)", and
 * DELIBERATELY ONLY THE SCHEDULING. The RMA workflow - reason codes, evidence
 * upload, seller inspection, the refund - is Phase 8, and this table holds no
 * opinion about any of it. What Phase 6 owns is the logistics primitive: a slot,
 * an address, and a courier who turns up.
 *
 * Keyed on the ORDER rather than on a return, because the return does not exist
 * yet. Phase 8 adds `return_id` alongside; a pickup booked before there is an
 * RMA to attach it to is exactly the ordering a buyer experiences.
 */
export const returnPickups = pgTable(
  'return_pickups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    buyerUserId: uuid('buyer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** RESTRICT: a booked slot cannot be deleted out from under the booking. */
    slotId: uuid('slot_id')
      .notNull()
      .references(() => deliverySlots.id, { onDelete: 'restrict' }),

    status: returnPickupStatus('status').notNull().default('SCHEDULED'),
    /** Snapshot, for the same reason `orders.shipping_address` is one. */
    pickupAddress: jsonb('pickup_address').notNull(),

    collectedAt: timestamp('collected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * ONE LIVE PICKUP PER ORDER, enforced by a partial unique index rather than
     * by a service check. Two couriers dispatched to the same doorstep is the
     * failure this prevents, and a prior SELECT cannot prevent it under
     * concurrency - the same lesson Phase 4 learned about idempotency keys.
     */
    uniqueIndex('return_pickups_one_live_per_order')
      .on(t.orderId)
      .where(sql`${t.status} = 'SCHEDULED'`),
    index('return_pickups_tenant_idx').on(t.tenantId),
    index('return_pickups_buyer_idx').on(t.buyerUserId),
    index('return_pickups_slot_idx').on(t.slotId),
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

/**
 * TENANT-OWNED. Which warehouse is holding which units for which order line.
 *
 * THIS TABLE EXISTS BECAUSE `inventory_items.reserved` IS A TOTAL, not a link.
 * Phase 4 incremented it and nothing recorded who the units were for, which was
 * harmless while every order reserved from one row. Phase 6 spread reservation
 * across warehouses and the gap became a correctness bug: dispatching order B
 * would happily consume the units order A had reserved, because at dispatch
 * time both were just "reserved" on the same row. Order A then found its stock
 * gone and could not ship.
 *
 * With this, dispatch allocates from the rows THIS order actually holds, and
 * `reserved` goes back to being what it reads like - a count, not a claim.
 *
 * One row per (order item, warehouse). A line split across two buildings has
 * two, which is exactly the "two shipments" the Phase 6 acceptance criterion
 * asks for, decided at reservation rather than guessed at dispatch.
 */
export const orderItemAllocations = pgTable(
  'order_item_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalised so RLS governs this table without joining two levels up. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    /**
     * RESTRICT: a warehouse holding reserved units for a live order cannot be
     * deleted. `WarehousesService.remove` already refuses a warehouse with
     * stock; this is the database saying the same thing where it cannot be
     * forgotten.
     */
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** Units still held here. Decremented as parcels leave; zero rows are kept. */
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('order_item_allocations_quantity_non_negative', sql`${t.quantity} >= 0`),
    unique('order_item_allocations_item_warehouse_key').on(t.orderItemId, t.warehouseId),
    index('order_item_allocations_tenant_idx').on(t.tenantId),
    index('order_item_allocations_item_idx').on(t.orderItemId),
    index('order_item_allocations_warehouse_idx').on(t.warehouseId),
  ],
);
