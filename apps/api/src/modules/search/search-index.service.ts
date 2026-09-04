import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  deleteAllSearchDocuments,
  insertAllSearchDocuments,
  pruneSearchDocument,
  upsertSearchDocument,
  upsertSearchDocumentsForTenant,
  type Transaction,
} from '@nexmarket/db';
import { withoutTenantScope } from '../../common/tenant-scope.js';

/**
 * THE ONLY WRITER of `search_documents` in the API.
 *
 * The statements themselves live in `@nexmarket/db` because the seed builds the
 * index too; the view in migration 0010 defines what a document is. Three
 * layers, one definition each: what a document is, how it is written, and when.
 *
 * Every method takes the CALLER's transaction rather than opening its own, so
 * the index commits with the write that caused it. A listing published and an
 * index update that failed afterwards is worse than neither happening.
 *
 * Every method clears the tenant scope around the statement, because a search
 * document is a cross-tenant aggregate - see withoutTenantScope, which explains
 * why this is one of exactly two places that move the tenant GUC.
 */
@Injectable()
export class SearchIndexService {
  /** Upsert-and-prune, so callers need not know whether the product still qualifies. */
  async reindexProduct(tx: Transaction, productId: string): Promise<void> {
    await withoutTenantScope(tx, async () => {
      await tx.execute(upsertSearchDocument(productId));
      await tx.execute(pruneSearchDocument(productId));
    });
  }

  /**
   * Reindexes the product a listing belongs to.
   *
   * The lookup runs in the CALLER's tenant scope, deliberately. A listing just
   * paused or archived is invisible under `public_active_offers`, so clearing
   * the scope first would find nothing and silently skip the reindex - leaving
   * the product advertising a price no longer on offer, which is the exact case
   * this exists to handle. Only the aggregate needs to be cross-tenant.
   */
  async reindexForListing(tx: Transaction, listingId: string): Promise<void> {
    const result = await tx.execute<{ product_id: string }>(sql`
      SELECT v.product_id FROM listings l
      JOIN product_variants v ON v.id = l.variant_id
      WHERE l.id = ${listingId}
    `);
    const productId = result.rows[0]?.product_id;
    if (productId !== undefined) await this.reindexProduct(tx, productId);
  }

  /**
   * Reindexes every product a tenant offers.
   *
   * Suspending a seller changes the cheapest price and the seller count on
   * every product they list, because a suspended seller's offers stop being
   * eligible. Without this the index keeps advertising a price nobody will
   * honour, and it is the least obvious of the reindex hooks - which is why the
   * drift test exercises suspension specifically.
   */
  async reindexForTenant(tx: Transaction, tenantId: string): Promise<void> {
    await withoutTenantScope(tx, async () => {
      await tx.execute(upsertSearchDocumentsForTenant(tenantId));
    });
  }

  /**
   * Rebuilds the whole index.
   *
   * For a change to the document definition - a new weighted field, a different
   * analyser - after which every row is wrong in the same way. NOT a repair for
   * a missed hook: a missing hook is a bug the drift test names, and a periodic
   * rebuild that papers over it makes the staleness window "however long since
   * the last run".
   */
  async reindexAll(tx: Transaction): Promise<number> {
    return withoutTenantScope(tx, async () => {
      await tx.execute(deleteAllSearchDocuments);
      const result = await tx.execute(insertAllSearchDocuments);
      return result.rowCount ?? 0;
    });
  }
}
