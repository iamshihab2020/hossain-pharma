import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
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

    /**
     * WHY it was flagged - 'profanity', 'links', 'velocity', 'reported'.
     *
     * A queue whose entries say only "flagged" teaches the next moderator
     * nothing and trains them to skim. An array rather than one reason because
     * the rules are independent and the COMBINATION is the signal: a link alone
     * is usually a mistake, while a link plus a flagged word plus the author's
     * fourth review this hour is not.
     *
     * Empty while PUBLISHED, and cleared on RESTORE - a review a human has
     * cleared should not carry the accusation that brought it in.
     */
    flagReasons: text('flag_reasons').array().notNull().default(sql`ARRAY[]::text[]`),

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

/**
 * Photos attached to a review. PRD 11 Phase 7, "reviews with photos".
 *
 * CASCADE FROM THE REVIEW and nothing else. A photo has no meaning apart from
 * the review it illustrates - it is not a gallery item, it is evidence for a
 * sentence - so it is never listed, searched or served on its own, and when the
 * author deletes their review the pictures go with it.
 *
 * That is also what makes moderation cheap: a REMOVED review stops being read,
 * so its photos stop being reachable, with no second thing to remember. The
 * alternative - moderating photos independently - would need its own status,
 * its own queue and its own way of going wrong.
 *
 * `storageKey` is opaque, per the FileStorage port: nothing outside an adapter
 * may parse, join or interpret it.
 */
export const reviewMedia = pgTable(
  'review_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_media_review_idx').on(t.reviewId, t.position)],
);

/**
 * "Was this helpful?" - PRD 9.5's helpful voting.
 *
 * ONE ROW PER PERSON PER REVIEW, with the pair as the primary key. Voting is
 * therefore idempotent by construction and un-voting is a DELETE; there is no
 * counter to get out of step and no "did they already vote" lookup that two
 * concurrent clicks could both pass.
 *
 * NO DENORMALISED `helpful_count`, and the contrast with `product_ratings` is
 * the point. A rating is denormalised because the BUY BOX ranks on it, in a
 * query over the whole catalogue that cannot afford to reach into reviews. A
 * helpful count is only ever shown on a page that has already fetched the
 * twenty reviews it belongs to, so a grouped count costs one join and owes
 * nobody a drift test. Denormalise where the read cannot afford the join, not
 * everywhere the number appears.
 *
 * Helpful only, with no "unhelpful". A downvote on a marketplace review is a
 * button for the seller who disliked it, and the signal it produces cannot be
 * told apart from the signal a genuinely poor review produces.
 */
export const reviewVotes = pgTable(
  'review_votes',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reviewId, t.userId] }),
    index('review_votes_review_idx').on(t.reviewId),
  ],
);

/**
 * Product Q&A. PRD 9.5's "Q&A section", and 9.2's seller staff who "answer
 * product questions".
 *
 * ASKING NEEDS NO PURCHASE, and that is the decision that separates this table
 * from `reviews` entirely. A review is a verdict on something you received, so
 * it hangs off an order line and cannot exist without one. A question is what
 * you ask BEFORE buying - "does it come with the charger?" - so requiring a
 * purchase would leave it askable only by the people who no longer need to ask.
 *
 * The consequence is that Q&A has no verification to lean on and therefore
 * leans on moderation instead: same `review_status`, same queue, same rule that
 * a report flags rather than hides.
 *
 * Platform-owned with no RLS, like everything else in this file: the Q&A
 * section is on the product page, read by somebody with no session.
 */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    status: reviewStatus('status').notNull().default('PUBLISHED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('questions_product_idx').on(t.productId, t.status)],
);

/**
 * An answer, from anybody - and marked when it comes from a seller.
 *
 * `seller_org_id` IS NULLABLE AND IT IS THE WHOLE POINT of this table's shape.
 * On a marketplace where several sellers list one product, "the seller replied"
 * is ambiguous until you say WHICH, and a buyer weighing two offers wants to
 * know whether the answer came from the one they are considering. A boolean
 * `is_seller` would lose exactly that.
 *
 * Null means another shopper answered, which is most of the useful traffic in
 * any real Q&A section and is not a lesser kind of answer.
 */
export const answers = pgTable(
  'answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The organisation the answerer was acting for, when they were acting for
     *  one. Never inferred at read time: membership changes, and an answer must
     *  keep saying who gave it. */
    sellerOrgId: uuid('seller_org_id').references(() => organisations.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    status: reviewStatus('status').notNull().default('PUBLISHED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('answers_question_idx').on(t.questionId, t.status)],
);
