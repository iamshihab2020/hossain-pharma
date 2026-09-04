import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import { decodeCursor, toPage, type Page } from '../../common/pagination.js';
import { SearchIndexService } from '../search/search-index.service.js';

export type ProductStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';

/**
 * PRD 9.2: a seller proposes a catalogue entry, an admin moderates it.
 *
 * REJECTED is terminal for that proposal - the seller proposes again rather
 * than editing a rejected row into life, so the record of what was refused
 * survives. ARCHIVED is how a published entry is retired.
 */
const PRODUCT_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  DRAFT: ['PENDING_REVIEW', 'ARCHIVED'],
  PENDING_REVIEW: ['ACTIVE', 'REJECTED', 'DRAFT'],
  ACTIVE: ['ARCHIVED'],
  REJECTED: [],
  ARCHIVED: [],
};

export type ProductQueueItem = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  status: ProductStatus;
  categorySlug: string;
  createdAt: Date;
};

export type ListingQueueItem = {
  id: string;
  status: string;
  sellerSlug: string;
  sku: string;
  productName: string;
  price: { amount: number; currency: string };
  createdAt: Date;
};

/**
 * Runs with `isAdmin` true and NO tenant. That is what makes the listing queue
 * possible at all: `platform_admin_bypass` in migration 0008 is the only policy
 * that lets a reader see PENDING_REVIEW offers belonging to every seller at
 * once, and reviewing sellers is the one job that is definitionally
 * cross-tenant.
 */
@Injectable()
export class CatalogueAdminService {
  constructor(private readonly searchIndex: SearchIndexService) {}

  async productQueue(query: {
    status?: ProductStatus;
    cursor?: string;
    limit: number;
  }): Promise<Page<ProductQueueItem>> {
    const ctx = getRequestContext();

    const conditions: SQL[] = [];
    if (query.status !== undefined) conditions.push(eq(schema.products.status, query.status));
    if (query.cursor !== undefined && query.cursor !== '') {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        sql`(${schema.products.createdAt}, ${schema.products.id}) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await ctx.tx
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        brand: schema.products.brand,
        status: schema.products.status,
        categorySlug: schema.categories.slug,
        createdAt: schema.products.createdAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(schema.products.createdAt), desc(schema.products.id))
      .limit(query.limit + 1);

    return toPage(rows, query.limit);
  }

  approveProduct(productId: string): Promise<ProductQueueItem> {
    return this.transitionProduct(productId, 'ACTIVE', null);
  }

  rejectProduct(productId: string, reason: string): Promise<ProductQueueItem> {
    return this.transitionProduct(productId, 'REJECTED', reason);
  }

  private async transitionProduct(
    productId: string,
    to: ProductStatus,
    note: string | null,
  ): Promise<ProductQueueItem> {
    const ctx = getRequestContext();

    const found = await ctx.tx
      .select({ status: schema.products.status })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1)
      // FOR UPDATE, so two reviewers cannot both act from the same starting
      // state and have the second silently overwrite the first.
      .for('update');
    const current = found[0];
    if (current === undefined) throw new NotFoundException('No such product');
    if (!PRODUCT_TRANSITIONS[current.status].includes(to)) {
      throw new ConflictException(`Cannot move a product from ${current.status} to ${to}`);
    }

    await ctx.tx
      .update(schema.products)
      .set({
        status: to,
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: note,
        updatedAt: new Date(),
      })
      .where(eq(schema.products.id, productId));

    // Approving a product puts it in the index; rejecting or archiving one
    // takes it out. Both are the same call, because reindexProduct upserts and
    // prunes rather than making the caller decide which applies.
    await this.searchIndex.reindexProduct(ctx.tx, productId);
    return this.oneProduct(productId);
  }

  private async oneProduct(productId: string): Promise<ProductQueueItem> {
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        brand: schema.products.brand,
        status: schema.products.status,
        categorySlug: schema.categories.slug,
        createdAt: schema.products.createdAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
      .where(eq(schema.products.id, productId))
      .limit(1);
    const product = rows[0];
    if (product === undefined) throw new NotFoundException('No such product');
    return product;
  }

  /**
   * The RESTRICTED-category review queue (plan P-C).
   *
   * Only listings in a restricted category ever reach PENDING_REVIEW, so this
   * queue is small by construction rather than by filtering.
   */
  async listingQueue(query: { cursor?: string; limit: number }): Promise<Page<ListingQueueItem>> {
    const ctx = getRequestContext();

    const conditions: SQL[] = [eq(schema.listings.status, 'PENDING_REVIEW')];
    if (query.cursor !== undefined && query.cursor !== '') {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        sql`(${schema.listings.createdAt}, ${schema.listings.id}) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await ctx.tx
      .select({
        id: schema.listings.id,
        status: schema.listings.status,
        sellerSlug: schema.organisations.slug,
        sku: schema.productVariants.sku,
        productName: schema.products.name,
        priceAmount: schema.listings.priceAmount,
        priceCurrency: schema.listings.priceCurrency,
        createdAt: schema.listings.createdAt,
      })
      .from(schema.listings)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.listings.tenantId))
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.listings.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(and(...conditions))
      .orderBy(desc(schema.listings.createdAt), desc(schema.listings.id))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        status: row.status,
        sellerSlug: row.sellerSlug,
        sku: row.sku,
        productName: row.productName,
        price: { amount: row.priceAmount, currency: row.priceCurrency },
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  approveListing(listingId: string): Promise<{ id: string; status: string }> {
    return this.transitionListing(listingId, 'ACTIVE', null);
  }

  /** Rejected goes back to DRAFT so the seller can fix and resubmit, with the reason. */
  rejectListing(listingId: string, reason: string): Promise<{ id: string; status: string }> {
    return this.transitionListing(listingId, 'DRAFT', reason);
  }

  private async transitionListing(
    listingId: string,
    to: 'ACTIVE' | 'DRAFT',
    note: string | null,
  ): Promise<{ id: string; status: string }> {
    const ctx = getRequestContext();

    const found = await ctx.tx
      .select({ status: schema.listings.status })
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId))
      .limit(1)
      .for('update');
    const current = found[0];
    if (current === undefined) throw new NotFoundException('No such listing');
    // Only a listing actually awaiting review may be decided. Approving an
    // ACTIVE listing is a no-op that looks like a decision; approving a DRAFT
    // one publishes an offer its seller never submitted.
    if (current.status !== 'PENDING_REVIEW') {
      throw new ConflictException(`That listing is ${current.status}, not awaiting review`);
    }

    const updated = await ctx.tx
      .update(schema.listings)
      .set({
        status: to,
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: note,
        updatedAt: new Date(),
      })
      .where(eq(schema.listings.id, listingId))
      .returning({ id: schema.listings.id, status: schema.listings.status });
    const row = updated[0];
    if (row === undefined) throw new ConflictException('The listing changed during review');
    await this.searchIndex.reindexForListing(ctx.tx, listingId);
    return row;
  }
}
