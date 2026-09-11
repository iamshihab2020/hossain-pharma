import { Injectable } from '@nestjs/common';
import {
  recomputeProductRating,
  recomputeSellerRating,
  type Transaction,
} from '@nexmarket/db';

/**
 * THE ONLY WRITER of `product_ratings` and `seller_ratings` in the API.
 *
 * The same arrangement `SearchIndexService` has with `search_documents`, and
 * for the same reason: `listings.available_stock` taught this codebase that a
 * denormalised column with two writers drifts under concurrency, so every
 * denormalisation since has had exactly one writer, one place that says when it
 * runs, and a test comparing it to its source.
 *
 * Every method takes the CALLER'S transaction rather than opening its own, so
 * the aggregate commits with the review that caused it. A review written and an
 * aggregate that failed afterwards is worse than neither happening: the page
 * would show a rating that no longer matches the reviews printed underneath it,
 * and nothing would ever notice.
 *
 * NO TENANT SCOPE JUGGLING, unlike the search index. All three tables here are
 * platform-owned with no row-level security - see `schema/reviews.ts` - so
 * these statements read the same rows whoever is connected. That is the whole
 * benefit of the ownership decision, and it is why this service is fifteen
 * lines and `SearchIndexService` needs `withoutTenantScope`.
 */
@Injectable()
export class ReviewAggregateService {
  /**
   * Both aggregates a single review contributes to.
   *
   * Always both, always together. One review counts once against the catalogue
   * entry and once against whoever fulfilled it, so a caller that refreshed
   * only the product would leave the buy box ranking on a stale seller score -
   * and the buy box is the surface where a wrong rating changes who gets the
   * sale.
   */
  async refreshFor(tx: Transaction, productId: string, sellerOrgId: string): Promise<void> {
    await tx.execute(recomputeProductRating(productId));
    await tx.execute(recomputeSellerRating(sellerOrgId));
  }
}
