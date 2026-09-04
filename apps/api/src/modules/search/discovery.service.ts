import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import type { SaveSearchInput } from './dto.js';

export type ViewedProduct = {
  productId: string;
  slug: string;
  name: string;
  viewedAt: Date;
};

export type SavedSearch = {
  id: string;
  name: string;
  query: Record<string, string>;
  createdAt: Date;
};

/** PRD 9.1: how many recently-viewed products a member keeps. */
const RECENTLY_VIEWED_KEPT = 20;

/**
 * The signed-in half of discovery: recently viewed, and saved searches.
 *
 * Both tables are platform-owned (PRD 6.2) with no RLS, so **every query here
 * filters on `ctx.userId`**. That is not a shortcut around a missing policy: a
 * buyer is not a tenant, there is no tenant to scope them to, and `sessions`
 * has been handled the same way since Phase 1. The filter is the boundary here,
 * which is why it appears in every single method rather than in a helper
 * someone could forget to call.
 */
@Injectable()
export class DiscoveryService {
  /**
   * PRD 9.1: "Recently viewed (cookie for guests, persisted for members)".
   *
   * One row per user per product, updated in place. A log of every view would
   * grow without bound to answer a question nobody asks - "when did they last
   * look at this" is the entire requirement.
   */
  async recordView(slug: string): Promise<void> {
    const ctx = getRequestContext();

    const products = await ctx.tx
      .select({ id: schema.searchDocuments.productId })
      .from(schema.searchDocuments)
      .where(eq(schema.searchDocuments.slug, slug))
      .limit(1);
    const productId = products[0]?.id;
    // Read from the search index, not from `products`: only a published product
    // has a row there, so an unpublished one cannot be added to a history that
    // would later render a 404.
    if (productId === undefined) throw new NotFoundException('No such product');

    await ctx.tx
      .insert(schema.recentlyViewed)
      .values({ userId: ctx.userId, productId })
      .onConflictDoUpdate({
        target: [schema.recentlyViewed.userId, schema.recentlyViewed.productId],
        set: { viewedAt: new Date() },
      });

    // Trim to the newest N. Done on write rather than on read so the table
    // cannot grow without bound for a user who never looks at their history.
    await ctx.tx.execute(sql`
      DELETE FROM recently_viewed
      WHERE user_id = ${ctx.userId}
        AND id NOT IN (
          SELECT id FROM recently_viewed
          WHERE user_id = ${ctx.userId}
          ORDER BY viewed_at DESC, id DESC
          LIMIT ${RECENTLY_VIEWED_KEPT}
        )
    `);
  }

  async recentlyViewed(): Promise<ViewedProduct[]> {
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select({
        productId: schema.recentlyViewed.productId,
        slug: schema.searchDocuments.slug,
        name: schema.searchDocuments.name,
        viewedAt: schema.recentlyViewed.viewedAt,
      })
      .from(schema.recentlyViewed)
      // INNER join to the index, so a product that has since been unpublished
      // drops out of the history rather than rendering a link to a 404.
      .innerJoin(
        schema.searchDocuments,
        eq(schema.searchDocuments.productId, schema.recentlyViewed.productId),
      )
      .where(eq(schema.recentlyViewed.userId, ctx.userId))
      .orderBy(desc(schema.recentlyViewed.viewedAt))
      .limit(RECENTLY_VIEWED_KEPT);
    return rows;
  }

  /**
   * PRD 9.1 "Saved searches with optional alerts".
   *
   * The searches are saved. NOTHING EMAILS ANYONE - alerts need the
   * notification system, which is Phase 9. There is deliberately no
   * `alerts_enabled` column that does nothing.
   */
  async saveSearch(input: SaveSearchInput): Promise<SavedSearch> {
    const ctx = getRequestContext();
    const inserted = await ctx.tx
      .insert(schema.savedSearches)
      .values({ userId: ctx.userId, name: input.name, query: input.query })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0];
    if (row === undefined) throw new ConflictException('You already saved a search with that name');
    return toSavedSearch(row);
  }

  async savedSearches(): Promise<SavedSearch[]> {
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select()
      .from(schema.savedSearches)
      .where(eq(schema.savedSearches.userId, ctx.userId))
      .orderBy(desc(schema.savedSearches.createdAt));
    return rows.map(toSavedSearch);
  }

  async deleteSavedSearch(id: string): Promise<void> {
    const ctx = getRequestContext();
    const deleted = await ctx.tx
      .delete(schema.savedSearches)
      // BOTH the id and the user id. Deleting on the id alone would let anyone
      // with a uuid remove someone else's saved search, and there is no policy
      // behind this to catch it.
      .where(and(eq(schema.savedSearches.id, id), eq(schema.savedSearches.userId, ctx.userId)))
      .returning({ id: schema.savedSearches.id });
    if (deleted[0] === undefined) throw new NotFoundException('No such saved search');
  }
}

function toSavedSearch(row: typeof schema.savedSearches.$inferSelect): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query as Record<string, string>,
    createdAt: row.createdAt,
  };
}
