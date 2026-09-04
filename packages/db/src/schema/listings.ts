import { bigint, char, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { productVariants } from './products.js';
import { warehouses } from './warehouses.js';

/** PRD 9.2. ARCHIVED is terminal; PAUSED is reversible. */
export const listingStatus = pgEnum('listing_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);

export const listingCondition = pgEnum('listing_condition', ['NEW', 'REFURBISHED', 'USED']);

/**
 * TENANT-OWNED (PRD 6.2). Migration 0008 puts ENABLE + FORCE + policies on it.
 *
 * A listing is one seller's offer on one variant - the other half of PRD 8.3.
 * Two sellers offering the same variant produce two rows, which is what makes a
 * buy box possible at all.
 *
 * PRICES ARE INTEGER MINOR UNITS. bigint, not numeric and never a float: the
 * legacy server did `parseInt(price * 100)`, which truncates, and @nexmarket/shared
 * exists to make that unrepresentable. `priceCurrency` travels with the amount
 * because a bare integer is not a price.
 */
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    status: listingStatus('status').notNull().default('DRAFT'),
    condition: listingCondition('condition').notNull().default('NEW'),

    priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
    priceCurrency: char('price_currency', { length: 3 }).notNull(),
    /** PRD 9.2 "sale price with schedule". The schedule is Phase 9; the price is here. */
    salePriceAmount: bigint('sale_price_amount', { mode: 'number' }),
    /**
     * Flat per-listing shipping, used by the Phase 2 buy box's landed price.
     *
     * Zone-aware quoting is Phase 6. The buy-box response carries
     * `basis: 'flat-shipping'` so nothing downstream mistakes this for one.
     */
    shippingAmount: bigint('shipping_amount', { mode: 'number' }).notNull().default(0),
    dispatchDays: integer('dispatch_days').notNull().default(1),

    /**
     * Sum of (on_hand - reserved) across this listing's inventory_items.
     *
     * A denormalisation, with one writer and a reason. The public product page
     * runs with NO tenant context, so it cannot read inventory_items - those
     * rows are tenant-isolated and exposing them publicly would publish every
     * seller's per-warehouse stock. But PRD 8.3 puts stock on the offer
     * ("...for BDT 38,500, 12 in stock, ships in 1 day"), and the buy box has to
     * exclude out-of-stock offers, so the number has to reach an anonymous
     * reader somehow.
     *
     * InventoryService is the ONLY thing that writes this, and it writes it in
     * the same transaction as the inventory_items row it summarises, so the two
     * cannot diverge across a failure. There is a test that asserts they agree
     * after every mutation path.
     *
     * This is not the same call as refusing to materialise the buy-box winner:
     * that is a ranking over rows from many tenants that change independently
     * with no invalidation story, whereas this is a sum over rows one service
     * owns and updates atomically.
     */
    availableStock: integer('available_stock').notNull().default(0),

    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One offer per seller per variant. Without this a seller can list the same
    // thing twice at two prices and appear as two competitors on their own
    // product page.
    unique('listings_tenant_variant_key').on(t.tenantId, t.variantId),
    // The buy-box query's driving predicate: every offer for one variant.
    index('listings_variant_idx').on(t.variantId),
    index('listings_tenant_idx').on(t.tenantId),
    index('listings_status_idx').on(t.status),
  ],
);

/**
 * TENANT-OWNED. Stock for one listing at one warehouse.
 *
 * `reserved` is written but never decremented in Phase 2 - reservation happens
 * at checkout, which is Phase 4. The column exists now so that
 * `available = on_hand - reserved` is defined from the start rather than
 * retrofitted onto rows that predate it.
 *
 * tenant_id is denormalised from the listing on purpose: the RLS policy has to
 * be evaluable from this row alone, and a policy that joins to `listings` to
 * find the tenant is both slower and a second place for the rule to be wrong.
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('inventory_items_listing_warehouse_key').on(t.listingId, t.warehouseId),
    index('inventory_items_tenant_idx').on(t.tenantId),
    index('inventory_items_listing_idx').on(t.listingId),
  ],
);
