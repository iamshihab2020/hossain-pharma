import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { averageRating, distribution, emptyHistogram, totalReviews } from '@nexmarket/shared';

export type StorefrontOffer = {
  listingId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  price: { amount: number; currency: string };
  availableStock: number;
};

export type Storefront = {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  memberSince: string;
  rating: {
    average: number | null;
    total: number;
    distribution: { stars: number; count: number; share: number }[];
  };
  /** What they sell, and how many of it. */
  listingCount: number;
  offers: StorefrontOffer[];
};

/**
 * A seller's own page. PRD 9.5: "Seller storefront pages with rating,
 * fulfilment stats, policies, full catalogue."
 *
 * PUBLIC, and it reads with no tenant. That is the fourth consequence of the
 * Phase 7 ownership decision: a storefront is a page strangers arrive at from a
 * product page, so `seller_ratings` has to be readable by somebody who is not
 * signed in and belongs to no organisation.
 *
 * `listings` is tenant-owned, so this reads it through the
 * `public_active_offers` policy from migration 0008 - the same policy the
 * catalogue relies on, which is why the offers below carry no explicit status
 * filter beyond ACTIVE and why a SUSPENDED seller's storefront shows no stock
 * without this service knowing anything about suspension.
 *
 * FULFILMENT STATS AND POLICIES ARE NOT HERE. Dispatch performance is Phase
 * 10's analytics work, which has the order history to compute it honestly; a
 * number invented here from the two columns to hand would be a worse version of
 * something a later phase owns. Policies need a place for a seller to write
 * them, which is a console screen this phase does not add.
 */
@Injectable()
export class StorefrontService {
  async bySlug(slug: string): Promise<Storefront> {
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
      const [org] = await tx
        .select({
          id: schema.organisations.id,
          slug: schema.organisations.slug,
          displayName: schema.organisations.displayName,
          countryCode: schema.organisations.countryCode,
          createdAt: schema.organisations.createdAt,
          status: schema.organisations.status,
        })
        .from(schema.organisations)
        .where(eq(schema.organisations.slug, slug))
        .limit(1);

      /**
       * A 404 for a seller who is not ACTIVE, not a page saying so.
       *
       * A suspended seller's storefront is not a status page for the public to
       * read - it is an enforcement action, and publishing it invites exactly
       * the argument nobody wants in a support queue. Their listings are
       * already invisible through `public_active_offers`, so the page would be
       * an empty shell with an explanation nobody is owed.
       */
      if (org === undefined || org.status !== 'ACTIVE') {
        throw new NotFoundException('No such seller');
      }

      const [rating, offers, listings] = await Promise.all([
        this.rating(tx, org.id),
        this.offers(tx, org.id),
        tx
          .select({ n: count() })
          .from(schema.listings)
          .where(
            and(eq(schema.listings.tenantId, org.id), eq(schema.listings.status, 'ACTIVE')),
          ),
      ]);

      return {
        id: org.id,
        slug: org.slug,
        displayName: org.displayName,
        countryCode: org.countryCode,
        memberSince: org.createdAt.toISOString(),
        rating,
        listingCount: listings[0]?.n ?? 0,
        offers,
      };
    });
  }

  private async rating(tx: Transaction, tenantId: string): Promise<Storefront['rating']> {
    const [row] = await tx
      .select()
      .from(schema.sellerRatings)
      .where(eq(schema.sellerRatings.tenantId, tenantId))
      .limit(1);

    const histogram =
      row === undefined
        ? emptyHistogram()
        : ([row.count1, row.count2, row.count3, row.count4, row.count5] as const);

    return {
      average: averageRating(histogram),
      total: totalReviews(histogram),
      distribution: distribution(histogram),
    };
  }

  /**
   * What this seller currently offers, newest first.
   *
   * Capped rather than paged, deliberately: a storefront is a shop window and
   * the catalogue proper is `/search?seller=`, which already has paging,
   * facets and sorting. A second paging implementation here would be a second
   * thing to get wrong for a page nobody scrolls to the bottom of.
   */
  private async offers(tx: Transaction, tenantId: string): Promise<StorefrontOffer[]> {
    return tx
      .select({
        listingId: schema.listings.id,
        productSlug: schema.products.slug,
        productName: schema.products.name,
        variantName: schema.productVariants.name,
        priceAmount: schema.listings.priceAmount,
        salePriceAmount: schema.listings.salePriceAmount,
        priceCurrency: schema.listings.priceCurrency,
        availableStock: schema.listings.availableStock,
      })
      .from(schema.listings)
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.listings.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.status, 'ACTIVE')))
      .orderBy(sql`${schema.listings.createdAt} DESC`)
      .limit(24)
      .then((rows) =>
        rows.map((row) => ({
          listingId: row.listingId,
          productSlug: row.productSlug,
          productName: row.productName,
          variantName: row.variantName,
          // The SALE price where there is one, because that is what the buyer
          // pays and what the buy box ranks on.
          price: {
            amount: row.salePriceAmount ?? row.priceAmount,
            currency: row.priceCurrency,
          },
          availableStock: row.availableStock,
        })),
      );
  }
}
