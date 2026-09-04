import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { categories } from './categories.js';

/**
 * PRD 9.2: a seller may propose a new catalogue entry, and an admin moderates
 * it. REJECTED is terminal for that proposal; the seller proposes again rather
 * than editing a rejected row into life.
 */
export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'REJECTED',
  'ARCHIVED',
]);

/**
 * PLATFORM-OWNED, and this is the single most important modelling decision in
 * the project (PRD 8.3).
 *
 * A product is the CATALOGUE ENTRY - "Samsung Galaxy A54, 128GB, Awesome
 * Violet" - shared by every seller who offers it. A seller's offer is a
 * `listing`, which is tenant-owned. The legacy schema had `products.email`,
 * one row per seller per product, which makes cross-seller comparison
 * impossible and is why there was no buy box to build.
 *
 * No tenant_id and no RLS, deliberately. `proposedBy` records which
 * organisation asked for the entry, for the moderation queue; it confers no
 * ownership and must never be used as a tenant column.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    brand: text('brand'),
    description: text('description'),
    status: productStatus('status').notNull().default('DRAFT'),
    /**
     * No foreign key to organisations, for the same reason
     * organisations.reviewedBy has none: products is imported by listings,
     * which imports organisations, and closing the cycle breaks Drizzle's
     * relation inference. Enforced in the service layer.
     */
    proposedBy: uuid('proposed_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    legacyMongoId: text('legacy_mongo_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
  ],
);

/**
 * The thing a seller actually offers and a buyer actually buys.
 *
 * Listings hang off a VARIANT, not a product: "Acme sells the 128GB violet one
 * for X" is a different offer from "Acme sells the 256GB black one for Y", and
 * a product-level listing cannot express that. PRD 9.1's variant selector
 * drives price, image and stock, all of which live below this line.
 *
 * Every product gets at least one variant, including products with nothing to
 * vary - a single "Default" row. The alternative, a nullable variant on
 * listings, means every join downstream carries a branch.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    barcode: text('barcode'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_variants_product_idx').on(t.productId)],
);

/**
 * storageKey is an opaque handle owned by the FileStorage port - not a URL and
 * not a filesystem path. Same rule as seller_documents: nothing outside an
 * adapter may interpret it, and it never appears in a response body.
 */
export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    originalFilename: text('original_filename').notNull(),
    altText: text('alt_text'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_media_product_idx').on(t.productId)],
);

/**
 * One row per product per attribute key, with three typed value columns and a
 * check constraint (migration 0008) that exactly one is set.
 *
 * Typed columns rather than JSONB because Phase 3 needs facet counts that match
 * the filtered result exactly - `GROUP BY value_text` over an indexed column is
 * a query, whereas the JSONB equivalent is a query plus a decision about which
 * paths to index and a cast that defeats the index when it is wrong.
 *
 * NUMBER is double precision, NOT money. Prices never live here; they are
 * integer minor units on `listings`. An attribute is "6.4 inches", not a price.
 */
export const productAttributes = pgTable(
  'product_attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueText: text('value_text'),
    valueNumber: doublePrecision('value_number'),
    valueBool: boolean('value_bool'),
  },
  (t) => [
    unique('product_attributes_product_key_key').on(t.productId, t.key),
    index('product_attributes_key_text_idx').on(t.key, t.valueText),
  ],
);
