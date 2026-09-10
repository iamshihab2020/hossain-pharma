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
import { listings } from './listings.js';
import { organisations } from './organisations.js';
import { paymentIntents } from './payments.js';
import { users } from './users.js';

/**
 * TENANT-OWNED. Migration 0012 puts ENABLE + FORCE + policies on both tables.
 *
 * One order belongs to exactly one seller - a cart spanning three sellers
 * produces three orders sharing one payment intent (PRD 11 Phase 4). So the
 * seller-side read is an ordinary tenant-scoped read.
 *
 * The buyer-side read is not. A buyer must see THEIR orders across every
 * seller, and a buyer is not a tenant, so their requests carry no
 * `app.tenant_id`. That is served by a SECOND permissive policy, `own_orders`,
 * gated on no tenant being selected and keyed on `app.user_id` - the third use
 * of the pattern that migrations 0006 and 0008 established, and the first that
 * reads the user GUC that ADR 0011 introduced. Ungated it would OR every
 * buyer's orders into every seller's console. ADR 0017.
 */

/**
 * The lifecycle lives in `order-state.ts` in @nexmarket/shared, which owns the
 * transition table and computes this column from line coverage. Nothing sets a
 * status by hand; a caller accepts, ships or cancels, and the status follows.
 *
 * Deliberately not PRD 9.2's list. PACKED moves no money and no stock and a
 * buyer cannot tell it from ACCEPTED; OUT_FOR_DELIVERY is a carrier event and
 * belongs to Phase 6; PARTIALLY_SHIPPED, which the Phase 5 acceptance criterion
 * requires, has nowhere to live in a linear list.
 */
export const orderStatus = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    buyerUserId: uuid('buyer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'restrict' }),
    /** Human-facing, per seller. PRD 9.1: "per-seller order numbers". */
    orderNumber: text('order_number').notNull(),
    status: orderStatus('status').notNull().default('PENDING_PAYMENT'),

    subtotalAmount: bigint('subtotal_amount', { mode: 'number' }).notNull(),
    shippingAmount: bigint('shipping_amount', { mode: 'number' }).notNull().default(0),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    commissionAmount: bigint('commission_amount', { mode: 'number' }).notNull().default(0),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    /**
     * A SNAPSHOT of the address, not a foreign key.
     *
     * An address edited or deleted next year must not silently restate where
     * last year's parcel was sent. Phase 5's packing slip reads this column.
     */
    shippingAddress: jsonb('shipping_address').notNull(),

    /**
     * PRD 9.1's age gate: "a date-of-birth confirmation, nothing heavier".
     *
     * The TIMESTAMP is stored, never the date of birth. PRD 13 minimises PII,
     * and a birth date retained to prove an 18+ check is more data than the
     * check needs.
     */
    ageVerifiedAt: timestamp('age_verified_at', { withTimezone: true }),

    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('orders_total_non_negative', sql`${t.totalAmount} >= 0`),
    unique('orders_order_number_key').on(t.orderNumber),
    index('orders_tenant_idx').on(t.tenantId),
    index('orders_buyer_idx').on(t.buyerUserId),
    index('orders_intent_idx').on(t.paymentIntentId),
    /** The buyer's order list pages on (placed_at, id), like every other list. */
    index('orders_buyer_placed_idx').on(t.buyerUserId, t.placedAt, t.id),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalised so RLS can govern this table without joining orders. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /**
     * RESTRICT, not CASCADE: an order item must outlive the listing it was
     * bought from. A seller archiving an offer cannot be allowed to delete the
     * evidence of what was sold.
     */
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),

    /**
     * SNAPSHOTS. The listing may be repriced, renamed or archived tomorrow; an
     * order that renders "unknown product" is a support ticket, and one whose
     * total silently follows today's price is a dispute.
     */
    productName: text('product_name').notNull(),
    variantSku: text('variant_sku').notNull(),
    unitPriceAmount: bigint('unit_price_amount', { mode: 'number' }).notNull(),
    quantity: integer('quantity').notNull(),
    /**
     * Units cancelled or rejected. Stored rather than derived, because unlike
     * SHIPPED quantity there is no child table to sum - a cancellation is a
     * fact about a line, not an object. One writer: FulfilmentService.
     *
     * Shipped quantity is deliberately NOT a column here. It is
     * SUM(shipment_items.quantity), because a denormalised counter would have
     * two writers - dispatch and cancellation - which is the drift that
     * listings.available_stock exists to warn about.
     */
    cancelledQuantity: integer('cancelled_quantity').notNull().default(0),
    lineTotalAmount: bigint('line_total_amount', { mode: 'number' }).notNull(),
    /** The rate that applied on the day, so a rate change cannot restate payables. */
    commissionBps: integer('commission_bps').notNull(),
    commissionAmount: bigint('commission_amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'order_items_cancelled_within_ordered',
      sql`${t.cancelledQuantity} >= 0 AND ${t.cancelledQuantity} <= ${t.quantity}`,
    ),
    index('order_items_tenant_idx').on(t.tenantId),
    index('order_items_order_idx').on(t.orderId),
    index('order_items_listing_idx').on(t.listingId),
  ],
);
