import {
  bigint,
  boolean,
  char,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { categories } from './categories.js';
import { products } from './products.js';
import { users } from './users.js';

/**
 * `tsvector`, which Drizzle has no built-in type for. Populated only by the
 * `search_document_source` view (migration 0010) and never read into
 * JavaScript - the application matches against it in SQL and nothing else.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

/**
 * PRD 8.1 and 11 Phase 3: the search materialisation.
 *
 * PLATFORM-OWNED and RLS-free, deliberately: every row here describes an ACTIVE
 * product that is already public on its own page. Nothing tenant-private
 * reaches this table - `min_price_amount` and `seller_count` are aggregates
 * over offers that are themselves public, and per-warehouse stock never appears.
 *
 * ONE ROW PER PRODUCT, not per listing. A buyer searches for a thing, not for a
 * seller's offer of a thing; results that repeat the same handset once per
 * seller are the failure mode PRD 8.3 exists to avoid.
 *
 * Maintained by SearchIndexService, whose only definition of a document is the
 * `search_document_source` view. See ADR 0015.
 */
export const searchDocuments = pgTable(
  'search_documents',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    brand: text('brand'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    categorySlug: text('category_slug').notNull(),
    categoryPath: ltree('category_path').notNull(),
    /**
     * The plain text the trigram operator matches against, kept alongside the
     * tsvector rather than derived from it: `tsv` is stemmed and lexeme-split,
     * so `similarity()` over it would compare stems and score typos worse than
     * comparing the words a human typed.
     */
    searchText: text('search_text').notNull(),
    tsv: tsvector('tsv').notNull(),

    /**
     * The cheapest LANDED price among eligible offers, or null when nobody is
     * offering the product. Eligibility is the buy box's rule, applied in the
     * view so the two cannot disagree.
     */
    minPriceAmount: bigint('min_price_amount', { mode: 'number' }),
    priceCurrency: char('price_currency', { length: 3 }),
    sellerCount: integer('seller_count').notNull().default(0),
    inStock: boolean('in_stock').notNull().default(false),

    /** The product's own createdAt, carried so "newest" sorts without a join. */
    productCreatedAt: timestamp('product_created_at', { withTimezone: true }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('search_documents_category_idx').on(t.categoryId),
    index('search_documents_brand_idx').on(t.brand),
    index('search_documents_price_idx').on(t.minPriceAmount),
    index('search_documents_created_idx').on(t.productCreatedAt),
  ],
);

/**
 * PRD 9.1: "Recently viewed (cookie for guests, persisted for members)".
 *
 * PLATFORM-OWNED. Buyers are not tenants (PRD 6.2), so this carries a user id
 * and no tenant id, and the service scopes it by the authenticated user -
 * exactly the treatment `sessions` gets.
 *
 * Guests get a cookie, not a row. A row for an anonymous visitor needs either a
 * fake user id or a nullable user_id that no scoping rule can express.
 */
export const recentlyViewed = pgTable(
  'recently_viewed',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per user per product, updated in place. A log of every view would
    // grow without bound to answer a question nobody asks - "when did they last
    // look at this" is the whole requirement.
    unique('recently_viewed_user_product_key').on(t.userId, t.productId),
    index('recently_viewed_user_idx').on(t.userId, t.viewedAt),
  ],
);

/**
 * PRD 9.1: "Saved searches with optional alerts".
 *
 * The searches are saved here. Alerts need the notification system, which is
 * Phase 9 - nothing in this phase emails anyone, and the schema does not
 * pretend otherwise by carrying an `alerts_enabled` column that does nothing.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * The query as the API received it. jsonb rather than a parsed column set,
     * because the filter vocabulary grows every phase and a saved search that
     * cannot round-trip a filter added later is worse than one stored opaquely.
     * It is re-validated on replay, never trusted.
     */
    query: jsonb('query').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('saved_searches_user_name_key').on(t.userId, t.name),
    index('saved_searches_user_idx').on(t.userId),
  ],
);
