import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { orderItems } from './orders.js';
import { products } from './products.js';
import { users } from './users.js';

/**
 * Phase 7, Trust. PRD 11 Phase 7 and 9.5.
 *
 * PLATFORM-OWNED, NO RLS - the same call the catalogue got and the Phase 6
 * geography tables got, forced by the same constraint. A rating histogram sits
 * on the PRODUCT PAGE, which runs with no tenant for a visitor who has chosen
 * no seller; a tenant-owned review table answers that reader with zero rows.
 * "My reviews" is scoped by `user_id` in the service, which is then the ONLY
 * boundary and is tested as one - the `recently_viewed` and `saved_searches`
 * shape. See ADR 0021 for the argument in full; this is its third application.
 */

/**
 * FLAGGED IS STILL VISIBLE, and that is the decision in this enum.
 *
 * A report is an accusation, not a verdict. Hiding content the moment somebody
 * objects hands a heckler's veto to whoever complains first, and on a
 * marketplace the first complainer is usually the seller the review is about.
 * So a flagged review stays on the page and enters the moderation queue; only a
 * human moving it to REMOVED takes it down.
 *
 * REMOVED is invisible on EVERY surface - the product page, the histogram, the
 * seller's rating, the buy box tiebreak and the search index - which is PRD
 * Phase 7's third acceptance criterion stated as data rather than as a promise.
 * It is a status rather than a DELETE so moderation is auditable and reversible;
 * Phase 11's audit log will want the row.
 */
export const reviewStatus = pgEnum('review_status', ['PUBLISHED', 'FLAGGED', 'REMOVED']);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * THE AUTHORISATION, and the reason this hangs off an order line rather
     * than off a product with a `verified` flag beside it.
     *
     * PRD 4.3's acceptance is "only delivered purchases can review". A boolean
     * on a product review is a claim the write path has to remember to check
     * and every later reader has to trust; a foreign key to the line somebody
     * actually bought cannot be forged, and UNIQUE on it is what makes "one
     * review per purchase" a constraint instead of a convention.
     *
     * ON DELETE CASCADE is deliberate and narrow: order items are never
     * deleted in this system (cancellation is a quantity, not a row), so this
     * is a safety net rather than a path anything takes.
     */
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),

    /**
     * THE SUBJECT. Resolved once at write time, not joined at read time.
     *
     * `order_items` carries `listing_id` and no product reference, so the
     * product is two joins away - through the listing to the variant. Storing
     * it here is not just the cheaper read: a listing can be ARCHIVED, and a
     * review of a product must outlive the offer that happened to sell it.
     */
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    /**
     * Who sold it, copied from the order.
     *
     * A SNAPSHOT in the same sense the order's shipping address is one. The
     * seller aggregate reads this without touching orders, and a review must go
     * on describing the seller who actually fulfilled it even if the listing
     * later moves or the catalogue entry is shared with a rival.
     */
    sellerOrgId: uuid('seller_org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 1-5 whole stars. The check is here because an aggregate over a rating of
     *  0 or 9 is silently wrong rather than loudly broken. */
    rating: integer('rating').notNull(),

    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),

    status: reviewStatus('status').notNull().default('PUBLISHED'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
    // ONE REVIEW PER PURCHASED LINE. Buying the same product twice earns a
    // second review; buying it once does not earn two.
    unique('reviews_order_item_key').on(t.orderItemId),
    index('reviews_product_idx').on(t.productId, t.status),
    index('reviews_seller_idx').on(t.sellerOrgId, t.status),
    index('reviews_author_idx').on(t.authorUserId),
  ],
);

/**
 * The histogram, and nothing derived from it.
 *
 * FIVE COUNTS ARE THE WHOLE TABLE. An average stored beside them is a second
 * source of truth for one fact, and this codebase has been bitten twice by a
 * denormalised column with two writers - which is why `listings.available_stock`
 * has exactly one documented writer and a drift test. The average is arithmetic
 * over five integers; computing it costs nothing and cannot disagree with the
 * histogram the page renders next to it.
 *
 * One writer: `ReviewAggregateService`, the same arrangement `search_documents`
 * has with `SearchIndexService`, and a drift test compares both tables to the
 * reviews they summarise.
 */
export const productRatings = pgTable('product_ratings', {
  productId: uuid('product_id')
    .primaryKey()
    .references(() => products.id, { onDelete: 'cascade' }),
  count1: integer('count_1').notNull().default(0),
  count2: integer('count_2').notNull().default(0),
  count3: integer('count_3').notNull().default(0),
  count4: integer('count_4').notNull().default(0),
  count5: integer('count_5').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The seller's score, aggregated from reviews of what they actually shipped.
 *
 * A product review and a seller review are the SAME ROW here, counted twice -
 * once against the catalogue entry and once against whoever fulfilled it. That
 * is a decision worth naming: a marketplace where competing sellers share one
 * product page has no separate "rate the seller" moment that buyers would
 * reliably complete, and a seller score nobody fills in leaves the buy box's
 * second ranking key permanently null. PRD 8.3 wrote that key in during Phase 2
 * and `catalogue.service` has been passing `sellerRating: null` ever since.
 *
 * The consequence to keep in mind: a seller carrying a badly-reviewed product
 * is marked down for it. That is arguably correct on a marketplace where the
 * seller chose the catalogue entry to list against, and Phase 10's fulfilment
 * metrics are where delivery performance gets measured separately.
 */
export const sellerRatings = pgTable('seller_ratings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  count1: integer('count_1').notNull().default(0),
  count2: integer('count_2').notNull().default(0),
  count3: integer('count_3').notNull().default(0),
  count4: integer('count_4').notNull().default(0),
  count5: integer('count_5').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
