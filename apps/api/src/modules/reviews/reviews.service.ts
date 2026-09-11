import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import {
  autoFlagReasons,
  averageRating,
  distribution,
  emptyHistogram,
  REVIEW_VELOCITY_WINDOW_MS,
  totalReviews,
  type RatingHistogram,
} from '@nexmarket/shared';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.port.js';
import { translateDbErrors } from '../../common/db-errors.js';
import { getRequestContext } from '../../common/request-context.js';
import { ReviewAggregateService } from './review-aggregate.service.js';
import type { CreateReviewInput, ModerateReviewInput, UpdateReviewInput } from './dto.js';

export type ReviewView = {
  id: string;
  productId: string;
  /** The product's slug, because `productId` routes nowhere: the product page
   *  is `/p/[slug]`. The moderation queue is the only reader that needs it and
   *  it is one join rather than a lookup per row. */
  productSlug: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  sellerName: string;
  status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED';
  /** Why a human is being asked to look. Empty unless FLAGGED. */
  flagReasons: string[];
  /** How many people found it useful. COUNTED, not denormalised - see the
   *  `review_votes` table comment for why this one does not get a column. */
  helpfulCount: number;
  /** Photo ids, in order. The bytes come from `GET /reviews/media/:id`. */
  photoIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type RatingSummary = {
  average: number | null;
  total: number;
  distribution: { stars: number; count: number; share: number }[];
};

/** A line the signed-in buyer has bought, delivered, and not yet reviewed. */
export type ReviewablePurchase = {
  orderItemId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  variantSku: string;
  sellerName: string;
  deliveredAt: Date;
};

/**
 * Verified-purchase reviews. PRD 11 Phase 7 and 9.5.
 *
 * `reviews` is platform-owned with no row-level security, because a rating
 * histogram is rendered on the PRODUCT PAGE for a visitor who has chosen no
 * seller and carries no tenant - the argument in ADR 0021, applied a third
 * time. So **the service is the entire boundary**, and it is a different
 * boundary on each verb, which is why none of them share a helper that could
 * quietly be applied to the wrong one:
 *
 *   - READS are public. A review is public content; that is what it is for.
 *   - WRITES are `ctx.userId`, checked against the order line being claimed.
 *   - MODERATION is `AdminGuard` on the controller, never a flag in a body.
 *
 * The one thing that is NOT enforced here is who may review: that is a foreign
 * key and a unique constraint, and the difference matters. See `create`.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly aggregates: ReviewAggregateService,
    @Inject(FILE_STORAGE) private readonly files: FileStorage,
  ) {}

  // ---- public reads --------------------------------------------------------

  /**
   * The reviews shown under a product, newest first.
   *
   * REMOVED is filtered here and in every other read, which is what makes PRD
   * Phase 7's third acceptance criterion - "moderation removes content from all
   * surfaces" - a property of the code rather than a list somebody maintains.
   * FLAGGED is not filtered: a report is an accusation, not a verdict.
   */
  async forProduct(productId: string, limit = 20): Promise<ReviewView[]> {
    return this.public(async (tx) => {
      const rows = await tx
      .select({
        review: schema.reviews,
        authorName: schema.users.displayName,
        sellerName: schema.organisations.displayName,
        productSlug: schema.products.slug,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.users.id, schema.reviews.authorUserId))
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.reviews.sellerOrgId))
      .innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
      .where(
        and(
          eq(schema.reviews.productId, productId),
          sql`${schema.reviews.status} <> 'REMOVED'`,
        ),
      )
        .orderBy(desc(schema.reviews.createdAt))
        .limit(limit);

      return this.decorate(tx, rows);
    });
  }

  /** The histogram and its average, straight off the aggregate table. */
  async summaryForProduct(productId: string): Promise<RatingSummary> {
    return this.public(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.productRatings)
        .where(eq(schema.productRatings.productId, productId))
        .limit(1);

      return toSummary(histogramOf(rows[0]));
    });
  }

  /**
   * Seller averages for the buy box, by organisation.
   *
   * Batched, because the buy box ranks every offer on a product in one pass and
   * a per-seller lookup there would be the N+1 this codebase keeps finding. A
   * seller with no reviews is ABSENT from the map rather than present with a
   * zero: `sellerRating` is `number | null` and an unrated seller must sort
   * behind a rated one, not below a one-star.
   */
  async sellerAverages(tx: Transaction, tenantIds: string[]): Promise<Map<string, number>> {
    if (tenantIds.length === 0) return new Map();

    const rows = await tx
      .select()
      .from(schema.sellerRatings)
      .where(inArray(schema.sellerRatings.tenantId, tenantIds));

    const averages = new Map<string, number>();
    for (const row of rows) {
      const average = averageRating(histogramOf(row));
      if (average !== null) averages.set(row.tenantId, average);
    }
    return averages;
  }

  // ---- the buyer's own ------------------------------------------------------

  /**
   * What this buyer may still review: delivered, theirs, and not already done.
   *
   * The same three conditions `create` enforces, asked as a question rather than
   * answered as an error - a "write a review" prompt that offers a line the
   * server will then refuse is worse than no prompt.
   */
  async reviewable(): Promise<ReviewablePurchase[]> {
    const ctx = this.user();
    const rows = await ctx.tx
      .select({
        orderItemId: schema.orderItems.id,
        orderNumber: schema.orders.orderNumber,
        productId: schema.productVariants.productId,
        productName: schema.orderItems.productName,
        variantSku: schema.orderItems.variantSku,
        sellerName: schema.organisations.displayName,
        deliveredAt: schema.orders.updatedAt,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.orderItems.listingId))
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.listings.variantId),
      )
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.orders.tenantId))
      .leftJoin(schema.reviews, eq(schema.reviews.orderItemId, schema.orderItems.id))
      .where(
        and(
          eq(schema.orders.buyerUserId, ctx.userId),
          eq(schema.orders.status, 'DELIVERED'),
          // Not yet reviewed. The unique constraint would refuse a second one
          // anyway; this is what stops the UI offering it.
          sql`${schema.reviews.id} IS NULL`,
        ),
      )
      .orderBy(desc(schema.orders.updatedAt));

    return rows;
  }

  // ---- writes ---------------------------------------------------------------

  /**
   * Write a review, having bought the thing.
   *
   * "ONLY DELIVERED PURCHASES CAN REVIEW" - PRD Phase 7's first acceptance
   * criterion - is three separate mechanisms here, and it is worth saying which
   * does what, because only one of them is code anybody could forget:
   *
   *   1. IT IS YOURS: the order's `buyer_user_id` must be the caller. A
   *      predicate in this query, and the only part a future edit could break.
   *   2. IT ARRIVED: the order's status must be DELIVERED. Also a predicate,
   *      and deliberately read at WRITE time rather than trusted from a badge -
   *      an order can be delivered after the page was rendered.
   *   3. ONCE: `reviews_order_item_key`. A UNIQUE CONSTRAINT, not a prior
   *      SELECT, for the same reason every other idempotency rule in this
   *      codebase is one - two concurrent submissions would both pass a lookup.
   *
   * The product is DERIVED from the order line rather than accepted from the
   * caller. A body that named both would let somebody review a product they had
   * not bought on the strength of one they had, and the verified-purchase badge
   * is exactly the thing that would then be worthless.
   */
  async create(input: CreateReviewInput): Promise<ReviewView> {
    const ctx = this.user();

    const [purchase] = await ctx.tx
      .select({
        productId: schema.productVariants.productId,
        sellerOrgId: schema.orders.tenantId,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.orderItems.listingId))
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.listings.variantId),
      )
      .where(
        and(
          eq(schema.orderItems.id, input.orderItemId),
          eq(schema.orders.buyerUserId, ctx.userId),
          eq(schema.orders.status, 'DELIVERED'),
        ),
      )
      .limit(1);

    if (purchase === undefined) {
      /**
       * ONE ANSWER for three different situations: no such line, somebody
       * else's line, and a line that has not arrived yet. Telling them apart
       * tells a stranger which order numbers exist and which have been
       * delivered, and the caller can do nothing differently with any of them.
       */
      throw new NotFoundException(
        'No delivered purchase of yours matches that order line',
      );
    }

    /**
     * AUTO-FLAGGING RUNS AT WRITE TIME, and it never refuses.
     *
     * PRD 9.6 asks for profanity and suspicious review velocity. Every rule can
     * only put a review in FRONT OF A HUMAN: a twenty-word list is wrong often
     * enough that letting it block would turn a moderation aid into a
     * censorship bug with a scheduler, and an honest buyer would be told their
     * review was unacceptable by a regex.
     *
     * So the review is written, it is visible, it counts toward the rating, and
     * a moderator finds it in the queue with the reasons attached.
     */
    const reasons = autoFlagReasons({
      title: input.title ?? '',
      body: input.body ?? '',
      recentByAuthor: await this.recentByAuthor(ctx.tx, ctx.userId),
    });

    return translateDbErrors(
      (async () => {
        const [row] = await ctx.tx
          .insert(schema.reviews)
          .values({
            orderItemId: input.orderItemId,
            productId: purchase.productId,
            sellerOrgId: purchase.sellerOrgId,
            authorUserId: ctx.userId,
            rating: input.rating,
            title: input.title ?? '',
            body: input.body ?? '',
            status: reasons.length > 0 ? 'FLAGGED' : 'PUBLISHED',
            flagReasons: reasons,
          })
          .onConflictDoNothing()
          .returning();

        // `DO NOTHING` then a check, rather than letting the constraint throw.
        // `ledger_entries` established the shape: the revoke on UPDATE makes
        // `DO UPDATE` unavailable repo-wide, and a row count is a clearer
        // answer than catching a driver error by code.
        if (row === undefined) {
          throw new ConflictException('You have already reviewed this purchase');
        }

        await this.aggregates.refreshFor(ctx.tx, purchase.productId, purchase.sellerOrgId);
        return this.one(ctx.tx, row.id);
      })(),
    );
  }

  /** Edit your own. The aggregate follows, because the stars may have moved. */
  async update(id: string, input: UpdateReviewInput): Promise<ReviewView> {
    const ctx = this.user();
    const existing = await this.own(ctx.tx, id, ctx.userId);

    await ctx.tx
      .update(schema.reviews)
      .set({
        ...(input.rating === undefined ? {} : { rating: input.rating }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.reviews.id, id), eq(schema.reviews.authorUserId, ctx.userId)));

    await this.aggregates.refreshFor(ctx.tx, existing.productId, existing.sellerOrgId);
    return this.one(ctx.tx, id);
  }

  /**
   * Delete your own, and this one really is a DELETE.
   *
   * Unlike moderation, which is a status. A person withdrawing their own words
   * should leave nothing behind; a moderator taking somebody else's down is an
   * act that has to stay auditable, and Phase 11's audit log will want the row.
   * Two verbs, two mechanisms, on purpose.
   */
  async remove(id: string): Promise<void> {
    const ctx = this.user();
    const existing = await this.own(ctx.tx, id, ctx.userId);

    await ctx.tx
      .delete(schema.reviews)
      .where(and(eq(schema.reviews.id, id), eq(schema.reviews.authorUserId, ctx.userId)));

    await this.aggregates.refreshFor(ctx.tx, existing.productId, existing.sellerOrgId);
  }

  // ---- moderation -----------------------------------------------------------

  /**
   * An admin takes content down, flags it, or puts it back.
   *
   * The aggregate refresh is what makes "removes content from ALL surfaces"
   * true: the review vanishes from the product page because every read filters
   * REMOVED, and it vanishes from the histogram, the seller's score and the buy
   * box tiebreak because this line runs. Without it the page would stop showing
   * the review while the rating above it still counted the stars.
   */
  async moderate(id: string, input: ModerateReviewInput): Promise<ReviewView> {
    const { tx } = getRequestContext();
    const [existing] = await tx
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .limit(1);
    if (existing === undefined) throw new NotFoundException('No such review');

    const status =
      input.action === 'REMOVE' ? 'REMOVED' : input.action === 'FLAG' ? 'FLAGGED' : 'PUBLISHED';

    /**
     * RESTORE clears the accusation, not just the status.
     *
     * A review a human has looked at and cleared should not go on carrying the
     * reasons that brought it in - otherwise it reads as "published, but we
     * still think it is a scam", and the next moderator scanning a list has no
     * way to tell a cleared review from one nobody has reached yet.
     */
    const flagReasons =
      input.action === 'RESTORE' ? [] : [...new Set([...existing.flagReasons, 'moderator'])];

    await tx
      .update(schema.reviews)
      .set({ status, flagReasons, updatedAt: new Date() })
      .where(eq(schema.reviews.id, id));

    await this.aggregates.refreshFor(tx, existing.productId, existing.sellerOrgId);
    return this.one(tx, id);
  }

  /**
   * A reader reports a review, which FLAGS it and does not hide it.
   *
   * Public on purpose - see the controller. Requiring an account to report
   * abuse means the abuse stays up while the person who noticed it registers.
   * The flag is idempotent by comparison rather than by a constraint: a review
   * already flagged or already removed is left exactly where it is, so a
   * brigade of reports cannot undo a moderator's decision.
   */
  async report(id: string): Promise<{ flagged: boolean }> {
    return this.public(async (tx) => {
      const result = await tx
        .update(schema.reviews)
        .set({
          status: 'FLAGGED',
          // APPENDED, not replaced. A human report on something the rules
          // already caught is more reason to look, not a different one.
          flagReasons: sql`ARRAY(SELECT DISTINCT unnest(${schema.reviews.flagReasons} || ARRAY['reported']))`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.reviews.id, id), eq(schema.reviews.status, 'PUBLISHED')))
        .returning({ id: schema.reviews.id });

      return { flagged: result.length > 0 };
    });
  }

  /** The moderation queue: everything a human still has to look at. */
  async flagged(limit = 50): Promise<ReviewView[]> {
    const { tx } = getRequestContext();
    const rows = await tx
      .select({
        review: schema.reviews,
        authorName: schema.users.displayName,
        sellerName: schema.organisations.displayName,
        productSlug: schema.products.slug,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.users.id, schema.reviews.authorUserId))
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.reviews.sellerOrgId))
      .innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
      .where(eq(schema.reviews.status, 'FLAGGED'))
      .orderBy(desc(schema.reviews.updatedAt))
      .limit(limit);

    return this.decorate(tx, rows);
  }

  // ---- internals ------------------------------------------------------------

  // ---- helpful votes --------------------------------------------------------

  /**
   * "I found this helpful", and pressing it again takes it back.
   *
   * IDEMPOTENT BY PRIMARY KEY. The pair (review, user) is the key, so a second
   * click cannot double-count and there is no "have they voted already" lookup
   * that two concurrent clicks could both pass. `ON CONFLICT DO NOTHING` then a
   * row count, which is the shape every other idempotent write here uses.
   *
   * You cannot vote on your own. Not because it would break anything - it is
   * one vote - but because a helpful count an author can raise is a number that
   * means slightly less for everybody, and the rule is cheap.
   */
  async vote(reviewId: string): Promise<{ helpfulCount: number; voted: boolean }> {
    const ctx = this.user();

    const [review] = await ctx.tx
      .select({ authorUserId: schema.reviews.authorUserId })
      .from(schema.reviews)
      .where(eq(schema.reviews.id, reviewId))
      .limit(1);
    if (review === undefined) throw new NotFoundException('No such review');
    if (review.authorUserId === ctx.userId) {
      throw new ConflictException('You cannot mark your own review helpful');
    }

    const inserted = await ctx.tx
      .insert(schema.reviewVotes)
      .values({ reviewId, userId: ctx.userId })
      .onConflictDoNothing()
      .returning({ reviewId: schema.reviewVotes.reviewId });

    // Already voted, so this press is the buyer taking it back.
    if (inserted.length === 0) {
      await ctx.tx
        .delete(schema.reviewVotes)
        .where(
          and(
            eq(schema.reviewVotes.reviewId, reviewId),
            eq(schema.reviewVotes.userId, ctx.userId),
          ),
        );
    }

    return {
      helpfulCount: await this.helpfulCount(ctx.tx, reviewId),
      voted: inserted.length > 0,
    };
  }

  // ---- photos ---------------------------------------------------------------

  /**
   * A photo on your own review. PRD 11 Phase 7, "reviews with photos".
   *
   * Through the `FileStorage` port, so the bytes land wherever the adapter puts
   * them and nothing here knows whether that is a disk or a bucket. The
   * `tenantId` the port wants is the SELLER's: a review photo is evidence about
   * one seller's goods, and if these ever move to per-tenant buckets that is
   * the bucket it belongs in.
   */
  async addPhoto(
    reviewId: string,
    input: { contentType: string; bytes: Buffer },
  ): Promise<{ id: string }> {
    const ctx = this.user();
    const review = await this.own(ctx.tx, reviewId, ctx.userId);

    const existing = await ctx.tx
      .select({ n: count() })
      .from(schema.reviewMedia)
      .where(eq(schema.reviewMedia.reviewId, reviewId));
    const position = existing[0]?.n ?? 0;
    if (position >= MAX_PHOTOS) {
      throw new ConflictException('A review may carry at most four photos');
    }

    const { storageKey } = await this.files.put(input.bytes, {
      tenantId: review.sellerOrgId,
      contentType: input.contentType,
    });

    const [row] = await ctx.tx
      .insert(schema.reviewMedia)
      .values({ reviewId, storageKey, contentType: input.contentType, position })
      .returning({ id: schema.reviewMedia.id });
    if (row === undefined) throw new ConflictException('Photo could not be stored');

    return { id: row.id };
  }

  /**
   * The bytes behind a photo id, for the public serve route.
   *
   * REFUSES A PHOTO ON A REMOVED REVIEW. Without this the pictures outlive
   * moderation: the review vanishes from every list while its photos stay
   * fetchable by anyone holding the id, which is "removes content from all
   * surfaces" quietly failing on the one surface nothing lists.
   */
  async photo(mediaId: string): Promise<{ bytes: Buffer; contentType: string }> {
    return this.public(async (tx) => {
      const [row] = await tx
        .select({
          storageKey: schema.reviewMedia.storageKey,
          contentType: schema.reviewMedia.contentType,
          status: schema.reviews.status,
        })
        .from(schema.reviewMedia)
        .innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewMedia.reviewId))
        .where(eq(schema.reviewMedia.id, mediaId))
        .limit(1);

      if (row === undefined || row.status === 'REMOVED') {
        throw new NotFoundException('No such photo');
      }

      return { bytes: await this.files.get(row.storageKey), contentType: row.contentType };
    });
  }

  /**
   * A transaction for the @Public() routes, which have none of their own.
   *
   * `@Public()` skips the AuthGuard AND the TenantInterceptor, so
   * `getRequestContext()` throws there rather than falling back - deliberately,
   * because a silent fallback is how a request ends up reading with whatever
   * tenant the pooled connection last carried. `CatalogueService` opens its own
   * for exactly the same reason, and this is the same pattern.
   *
   * NO TENANT, which is the whole ownership decision in one argument: these
   * three tables carry no RLS, so a reader with no tenant sees every seller's
   * reviews - which is what a product page is.
   */
  private async public<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
  }

  private async one(tx: Transaction, id: string): Promise<ReviewView> {
    const [row] = await tx
      .select({
        review: schema.reviews,
        authorName: schema.users.displayName,
        sellerName: schema.organisations.displayName,
        productSlug: schema.products.slug,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.users.id, schema.reviews.authorUserId))
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.reviews.sellerOrgId))
      .innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
      .where(eq(schema.reviews.id, id))
      .limit(1);

    if (row === undefined) throw new NotFoundException('No such review');
    const [view] = await this.decorate(tx, [row]);
    if (view === undefined) throw new NotFoundException('No such review');
    return view;
  }

  /** Yours, or a 404. Never a 403 - saying "forbidden" confirms it exists. */
  private async own(
    tx: Transaction,
    id: string,
    userId: string,
  ): Promise<typeof schema.reviews.$inferSelect> {
    const [row] = await tx
      .select()
      .from(schema.reviews)
      // Both predicates, always. `eq(id)` alone edits somebody else's words.
      .where(and(eq(schema.reviews.id, id), eq(schema.reviews.authorUserId, userId)))
      .limit(1);

    if (row === undefined) throw new NotFoundException('No such review');
    return row;
  }

  /**
   * Attaches votes and photos to a page of reviews, in TWO QUERIES.
   *
   * Not one per review. Twenty reviews would be forty extra round trips, which
   * is the N+1 this codebase keeps finding - and it would land on the product
   * page, the one surface whose whole argument for server rendering is that it
   * arrives in the first response.
   */
  private async decorate(
    tx: Transaction,
    rows: {
      review: typeof schema.reviews.$inferSelect;
      authorName: string;
      sellerName: string;
      productSlug: string;
    }[],
  ): Promise<ReviewView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.review.id);

    const [votes, photos] = await Promise.all([
      tx
        .select({ reviewId: schema.reviewVotes.reviewId, n: count() })
        .from(schema.reviewVotes)
        .where(inArray(schema.reviewVotes.reviewId, ids))
        .groupBy(schema.reviewVotes.reviewId),
      tx
        .select({ id: schema.reviewMedia.id, reviewId: schema.reviewMedia.reviewId })
        .from(schema.reviewMedia)
        .where(inArray(schema.reviewMedia.reviewId, ids))
        .orderBy(schema.reviewMedia.position),
    ]);

    const voteCounts = new Map(votes.map((row) => [row.reviewId, row.n]));
    const photoIds = new Map<string, string[]>();
    for (const photo of photos) {
      photoIds.set(photo.reviewId, [...(photoIds.get(photo.reviewId) ?? []), photo.id]);
    }

    return rows.map((row) =>
      toView(row.review, row.authorName, row.sellerName, {
        productSlug: row.productSlug,
        helpfulCount: voteCounts.get(row.review.id) ?? 0,
        photoIds: photoIds.get(row.review.id) ?? [],
      }),
    );
  }

  private async helpfulCount(tx: Transaction, reviewId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(schema.reviewVotes)
      .where(eq(schema.reviewVotes.reviewId, reviewId));
    return row?.n ?? 0;
  }

  /**
   * The author's other reviews inside the velocity window.
   *
   * Timestamps rather than a count, because `exceedsReviewVelocity` takes them
   * - a helper accepting a number could be handed a lifetime total by mistake
   * and read it as a burst.
   */
  private async recentByAuthor(tx: Transaction, userId: string): Promise<Date[]> {
    const since = new Date(Date.now() - REVIEW_VELOCITY_WINDOW_MS);
    const rows = await tx
      .select({ createdAt: schema.reviews.createdAt })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.authorUserId, userId), gte(schema.reviews.createdAt, since)));
    return rows.map((row) => row.createdAt);
  }

  private user(): { tx: Transaction; userId: string } {
    const ctx = getRequestContext();
    if (ctx.userId === null) throw new NotFoundException('No such review');
    return { tx: ctx.tx, userId: ctx.userId };
  }
}

/** How many photos one review may carry. Enough to show a fault from two
 *  angles; not an album. */
const MAX_PHOTOS = 4;

function toView(
  row: typeof schema.reviews.$inferSelect,
  authorName: string,
  sellerName: string,
  extras: { productSlug: string; helpfulCount: number; photoIds: string[] },
): ReviewView {
  return {
    id: row.id,
    productId: row.productId,
    productSlug: extras.productSlug,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName,
    sellerName,
    status: row.status,
    flagReasons: row.flagReasons,
    helpfulCount: extras.helpfulCount,
    photoIds: extras.photoIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The five columns as the shared arithmetic wants them, or five zeroes. */
function histogramOf(
  row: { count1: number; count2: number; count3: number; count4: number; count5: number } | undefined,
): RatingHistogram {
  if (row === undefined) return emptyHistogram();
  return [row.count1, row.count2, row.count3, row.count4, row.count5];
}

function toSummary(histogram: RatingHistogram): RatingSummary {
  return {
    average: averageRating(histogram),
    total: totalReviews(histogram),
    distribution: distribution(histogram),
  };
}
