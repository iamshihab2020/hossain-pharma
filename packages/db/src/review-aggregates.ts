import { sql, type SQL } from 'drizzle-orm';

/**
 * The statements that maintain `product_ratings` and `seller_ratings`.
 *
 * Here rather than in the API for the reason `search-index.ts` is here: the
 * SEED writes reviews too, and a seed carrying its own copy of the aggregate is
 * a second definition of what a rating is - the first time one changes, every
 * rating test starts testing a fixture. `ReviewAggregateService` decides WHEN
 * these run; this decides what they compute.
 *
 * FULL RECOMPUTE FROM SOURCE, never an increment.
 *
 * A `+1` on insert and a `-1` on delete is smaller and is how aggregates
 * usually drift: an edit is a decrement and an increment that must both land, a
 * moderation is a decrement that must not run twice, and a missed pair is
 * invisible until somebody counts by hand. Recomputing one product's five
 * integers reads a handful of rows behind an index, and PRD Phase 7's second
 * acceptance criterion - "aggregates recompute correctly on edit/delete" -
 * stops being a behaviour to test and becomes the only thing the code can do.
 *
 * REMOVED is excluded and FLAGGED is not. What a visitor can see is what the
 * histogram counts, and a flagged review is still on the page - see the
 * `review_status` enum for why a report is not a verdict.
 */

/** The five buckets, unaliased, for an INSERT ... SELECT where position is all
 *  that matters. Aliasing inside a template would name only the last one. */
const BUCKETS = sql`
  count(*) FILTER (WHERE r.rating = 1)::int,
  count(*) FILTER (WHERE r.rating = 2)::int,
  count(*) FILTER (WHERE r.rating = 3)::int,
  count(*) FILTER (WHERE r.rating = 4)::int,
  count(*) FILTER (WHERE r.rating = 5)::int
`;

/** The same five, named, for anything that reads them back by column. */
const NAMED_BUCKETS = sql`
  count(*) FILTER (WHERE r.rating = 1)::int AS c1,
  count(*) FILTER (WHERE r.rating = 2)::int AS c2,
  count(*) FILTER (WHERE r.rating = 3)::int AS c3,
  count(*) FILTER (WHERE r.rating = 4)::int AS c4,
  count(*) FILTER (WHERE r.rating = 5)::int AS c5
`;

const UPDATES = sql`
  count_1 = EXCLUDED.count_1,
  count_2 = EXCLUDED.count_2,
  count_3 = EXCLUDED.count_3,
  count_4 = EXCLUDED.count_4,
  count_5 = EXCLUDED.count_5,
  updated_at = now()
`;

/** VISIBLE means counted. Defined once so the aggregate, the full rebuild and
 *  the drift check cannot disagree about which reviews exist. */
const VISIBLE = sql`r.status <> 'REMOVED'`;

/**
 * One product's histogram, rebuilt from its reviews.
 *
 * `COALESCE` over an empty aggregate so the row is written even when every
 * review has been removed: five zeroes and "no aggregate row yet" are the same
 * fact, and one code path should produce it rather than the page having to
 * handle both.
 */
export function recomputeProductRating(productId: string): SQL {
  return sql`
    INSERT INTO product_ratings (product_id, count_1, count_2, count_3, count_4, count_5, updated_at)
    SELECT ${productId}::uuid, ${BUCKETS}, now()
      FROM reviews r
     WHERE r.product_id = ${productId}::uuid
       AND ${VISIBLE}
    ON CONFLICT (product_id) DO UPDATE SET ${UPDATES}
  `;
}

/** One seller's histogram, over every review of everything they sold. */
export function recomputeSellerRating(tenantId: string): SQL {
  return sql`
    INSERT INTO seller_ratings (tenant_id, count_1, count_2, count_3, count_4, count_5, updated_at)
    SELECT ${tenantId}::uuid, ${BUCKETS}, now()
      FROM reviews r
     WHERE r.seller_org_id = ${tenantId}::uuid
       AND ${VISIBLE}
    ON CONFLICT (tenant_id) DO UPDATE SET ${UPDATES}
  `;
}

/**
 * A full rebuild, as three statements rather than one.
 *
 * Deliberately not a single data-modifying CTE. Every sub-statement in one of
 * those sees the SAME SNAPSHOT, so an `INSERT` beside a `DELETE` on the same
 * table does not see the delete and collides with the rows it is replacing on
 * the primary key. Clear, then insert, in that order - which is also exactly
 * what `deleteAllSearchDocuments` / `insertAllSearchDocuments` already do.
 *
 * The API never needs these: it always knows which product and which seller a
 * change touched. The seed does.
 */
export const clearAllRatings: readonly SQL[] = [
  sql`DELETE FROM product_ratings`,
  sql`DELETE FROM seller_ratings`,
];

export const insertAllProductRatings: SQL = sql`
  INSERT INTO product_ratings (product_id, count_1, count_2, count_3, count_4, count_5, updated_at)
  SELECT r.product_id, ${BUCKETS}, now()
    FROM reviews r
   WHERE ${VISIBLE}
   GROUP BY r.product_id
`;

export const insertAllSellerRatings: SQL = sql`
  INSERT INTO seller_ratings (tenant_id, count_1, count_2, count_3, count_4, count_5, updated_at)
  SELECT r.seller_org_id, ${BUCKETS}, now()
    FROM reviews r
   WHERE ${VISIBLE}
   GROUP BY r.seller_org_id
`;

/**
 * Every aggregate row that disagrees with the reviews beneath it.
 *
 * Exists for the drift test and nothing else, and it belongs here rather than
 * in the test for the reason the rest of this file does: a comparison written
 * inside a test is a second definition of the aggregate, and it will agree with
 * the bug. `listings.available_stock` earned this pattern - a denormalised
 * column is trustworthy exactly as long as something compares it to its source.
 *
 * FULL OUTER JOIN, so it catches all three shapes of wrong: a row with the
 * wrong counts, an aggregate for reviews that no longer exist, and reviews with
 * no aggregate at all. An empty result is the only passing answer.
 */
export const ratingDrift: SQL = sql`
  WITH expected_products AS (
    SELECT r.product_id AS id, ${NAMED_BUCKETS}
      FROM reviews r WHERE ${VISIBLE} GROUP BY r.product_id
  ),
  expected_sellers AS (
    SELECT r.seller_org_id AS id, ${NAMED_BUCKETS}
      FROM reviews r WHERE ${VISIBLE} GROUP BY r.seller_org_id
  )
  SELECT 'product' AS kind, COALESCE(e.id, a.product_id)::text AS id
    FROM expected_products e
    FULL OUTER JOIN product_ratings a ON a.product_id = e.id
   WHERE COALESCE(e.c1, 0) IS DISTINCT FROM COALESCE(a.count_1, 0)
      OR COALESCE(e.c2, 0) IS DISTINCT FROM COALESCE(a.count_2, 0)
      OR COALESCE(e.c3, 0) IS DISTINCT FROM COALESCE(a.count_3, 0)
      OR COALESCE(e.c4, 0) IS DISTINCT FROM COALESCE(a.count_4, 0)
      OR COALESCE(e.c5, 0) IS DISTINCT FROM COALESCE(a.count_5, 0)
  UNION ALL
  SELECT 'seller' AS kind, COALESCE(e.id, a.tenant_id)::text AS id
    FROM expected_sellers e
    FULL OUTER JOIN seller_ratings a ON a.tenant_id = e.id
   WHERE COALESCE(e.c1, 0) IS DISTINCT FROM COALESCE(a.count_1, 0)
      OR COALESCE(e.c2, 0) IS DISTINCT FROM COALESCE(a.count_2, 0)
      OR COALESCE(e.c3, 0) IS DISTINCT FROM COALESCE(a.count_3, 0)
      OR COALESCE(e.c4, 0) IS DISTINCT FROM COALESCE(a.count_4, 0)
      OR COALESCE(e.c5, 0) IS DISTINCT FROM COALESCE(a.count_5, 0)
`;
