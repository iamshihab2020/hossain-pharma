import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { withTenant, type Transaction } from '@nexmarket/db';
import { decodeCursor, encodeCursor, type Page } from '../../common/pagination.js';
import type { SearchQuery, SortKey } from './dto.js';

export type SearchHit = {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  categorySlug: string;
  price: { amount: number; currency: string } | null;
  sellerCount: number;
  inStock: boolean;
  createdAt: Date;
};

export type FacetValue = { value: string; label: string; count: number };
export type Facets = {
  category: FacetValue[];
  brand: FacetValue[];
  availability: FacetValue[];
  price: FacetValue[];
  attributes: { key: string; label: string; values: FacetValue[] }[];
};

export type SearchResult = Page<SearchHit> & { total: number; facets: Facets };

/**
 * The threshold for "did they mean this", used with the WORD similarity
 * operator `<%`.
 *
 * `%` was tried first and is the wrong tool: it compares the query against the
 * WHOLE document, so "alphonzo" against "Alphonso Mango Crate Verdant Fresh
 * Produce Rangpur" scores far below any usable threshold, and typo tolerance
 * silently worked only for short documents. `<%` asks whether the query
 * resembles some CONTINUOUS EXTENT of the text, which is the question a
 * misspelled word actually poses. It uses the same GIN trigram index.
 *
 * 0.5 rather than pg_trgm's 0.6 default, chosen against measured values rather
 * than by feel. Against the fixture documents:
 *
 *   alphonzo -> 0.67    pineaple -> 0.73    himsager -> 0.67
 *   jackfruite -> 0.82  mango -> 1.00       zzzzqqqqxxxx -> 0.00
 *
 * 0.6 would have admitted all of those too; 0.5 leaves room for a second
 * mistake in one word without approaching the zero that nonsense scores.
 *
 * It is a GUC, not a function argument - there is no `set_word_similarity_limit`
 * despite `set_limit` existing for the plain `%` operator, and reaching for the
 * symmetrical-looking name is a 500 on every search until a test says so.
 * Written transaction-locally with set_config so the API's typo tolerance
 * depends on this repository and not on how somebody configured the server.
 */
const WORD_SIMILARITY_THRESHOLD = 0.5;

/**
 * The dimensions a facet can exclude from its own counts.
 *
 * A named union rather than `keyof SearchQuery`: `price` covers two query
 * fields (`minPrice` and `maxPrice`) and `attributes` covers an open-ended set,
 * so the facet dimensions are not the query fields and pretending they are lets
 * a typo compile.
 */
type FacetDimension = 'category' | 'brand' | 'inStock' | 'price' | 'attributes';

/** PRD 9.1 price facet buckets, in minor units. Coarse on purpose - see below. */
const PRICE_BUCKETS = [
  { value: '0-100000', label: 'Under 1,000', min: 0, max: 100_000 },
  { value: '100000-1000000', label: '1,000 – 10,000', min: 100_000, max: 1_000_000 },
  { value: '1000000-5000000', label: '10,000 – 50,000', min: 1_000_000, max: 5_000_000 },
  { value: '5000000-', label: 'Over 50,000', min: 5_000_000, max: null },
] as const;

/**
 * PRD 9.1 discovery and PRD 11's blocking criterion: "facet counts match
 * filtered results exactly".
 *
 * The only way to guarantee that is for the counts and the results to come from
 * ONE predicate, evaluated in ONE transaction. `buildPredicate` is that
 * predicate; the result page applies all of it, and each facet dimension
 * applies all of it EXCEPT its own filter.
 *
 * Excluding a dimension from its own counts is the standard drill-down
 * semantic: with "Brand: Aurora" selected, the Brand facet still has to say how
 * many results Samsung would give, or the filter can never be changed. Applying
 * every filter to every facet would show zero for each unselected value -
 * trivially "exact", and useless.
 */
@Injectable()
export class SearchService {
  private run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // Public, like the rest of discovery: search runs with no tenant and no
    // user. search_documents has no RLS because every row in it describes an
    // ACTIVE product that already has a public page.
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    return this.run(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(WORD_SIMILARITY_THRESHOLD)}, true)`,
      );

      const all = this.buildPredicate(query);
      const rows = await tx.execute<{
        product_id: string;
        slug: string;
        name: string;
        brand: string | null;
        category_slug: string;
        min_price_amount: string | null;
        price_currency: string | null;
        seller_count: number;
        in_stock: boolean;
        product_created_at: Date;
        rank: number;
      }>(sql`
        SELECT d.product_id, d.slug, d.name, d.brand, d.category_slug,
               d.min_price_amount, d.price_currency, d.seller_count, d.in_stock,
               d.product_created_at, ${this.rankExpression(query)} AS rank
        FROM search_documents d
        WHERE ${all}
        ORDER BY ${this.orderBy(query)}
        LIMIT ${query.limit + 1}
      `);

      const hasMore = rows.rows.length > query.limit;
      const kept = hasMore ? rows.rows.slice(0, query.limit) : rows.rows;
      const items = kept.map(toHit);

      const { total, facets } = await this.aggregate(tx, query, all);

      const last = items[items.length - 1];
      return {
        items,
        // Cursor pagination is on (createdAt, id) per PRD 13. Relevance sorting
        // cannot use it - rank is not stable across inserts - so a relevance
        // search pages by its own ordering and the cursor carries the product's
        // createdAt/id pair the same way; see orderBy.
        nextCursor: hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.productId })
          : null,
        total,
        facets,
      };
    });
  }

  // ------------------------------------------------------------------ predicate

  /**
   * One predicate. `except` drops a single dimension so that dimension's own
   * facet counts stay drillable.
   */
  private buildPredicate(query: SearchQuery, except?: FacetDimension): SQL {
    const parts: SQL[] = [sql`TRUE`];

    if (query.q !== undefined && query.q !== '') {
      // FULL TEXT **OR** WORD-TRIGRAM, IN ONE PREDICATE - not a fallback.
      //
      // "Run FTS, and if it returns too little run trigram instead" produces two
      // different result sets, so the facet counts would describe a different
      // query than the results and the exactness criterion fails on any
      // borderline search. One predicate, one set of rows, counts that match by
      // construction. Both halves are GIN-indexed, so the OR is not a scan.
      parts.push(
        sql`(d.tsv @@ websearch_to_tsquery('english', ${query.q}) OR ${query.q}::text <% d.search_text)`,
      );
    }

    if (except !== 'category' && query.category !== undefined) {
      // Subtree, so filtering on "electronics" keeps smartphones. Same ltree
      // operator and same GiST-backed reasoning as the catalogue browse.
      parts.push(
        sql`d.category_path <@ (SELECT path FROM categories WHERE slug = ${query.category})`,
      );
    }
    if (except !== 'brand' && query.brand !== undefined) {
      parts.push(sql`d.brand = ${query.brand}`);
    }
    if (except !== 'inStock' && query.inStock === true) {
      parts.push(sql`d.in_stock = TRUE`);
    }
    if (except !== 'price') {
      if (query.minPrice !== undefined) parts.push(sql`d.min_price_amount >= ${query.minPrice}`);
      if (query.maxPrice !== undefined) parts.push(sql`d.min_price_amount <= ${query.maxPrice}`);
    }

    if (except !== 'attributes') {
      for (const [key, value] of Object.entries(query.attributes ?? {})) {
        // Per-category dynamic facets (PRD 9.1). An EXISTS against
        // product_attributes rather than a column on the document: the
        // vocabulary is per category and unbounded, and a jsonb column here
        // would need a decision about which paths to index.
        parts.push(sql`EXISTS (
          SELECT 1 FROM product_attributes pa
          WHERE pa.product_id = d.product_id AND pa.key = ${key} AND pa.value_text = ${value}
        )`);
      }
    }

    if (query.cursor !== undefined && query.cursor !== '') {
      const cursor = decodeCursor(query.cursor);
      parts.push(
        sql`(d.product_created_at, d.product_id) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`,
      );
    }

    return sql.join(parts, sql` AND `);
  }

  private rankExpression(query: SearchQuery): SQL {
    if (query.q === undefined || query.q === '') return sql`0::float4`;
    // A LEXICAL MATCH ALWAYS OUTRANKS A FUZZY ONE, and each row pays for one
    // scoring function rather than two.
    //
    // The first version added the two scores together, which conflates scales
    // that mean different things - `ts_rank` is "how well do these lexemes fit
    // this document", `word_similarity` is "how close is this string to some
    // word in it" - and let a near-miss on a common word outscore an exact hit.
    // The `+ 1` puts every lexical match above every fuzzy-only one by
    // construction, which is what a person typing a word they spelled correctly
    // expects.
    //
    // It is also half the work. Measured against 50k documents for a term
    // matching every one of them:
    //
    //   ts_rank_cd + word_similarity ......... 1294 ms
    //   ts_rank    + word_similarity .......... 246 ms
    //   CASE: ts_rank OR word_similarity ...... see the perf suite's report
    //
    // Rank has to be computed for every match before the top twenty are known,
    // so a broad query pays whatever this expression costs fifty thousand times.
    return sql`(
      CASE WHEN d.tsv @@ websearch_to_tsquery('english', ${query.q})
        THEN 1 + ts_rank(d.tsv, websearch_to_tsquery('english', ${query.q}))
        ELSE word_similarity(${query.q}::text, d.search_text)
      END
    )`;
  }

  private orderBy(query: SearchQuery): SQL {
    const tiebreak = sql`d.product_created_at DESC, d.product_id DESC`;
    const sort: SortKey = query.sort ?? 'relevance';
    switch (sort) {
      case 'price_asc':
        // NULLS LAST on every price sort: a product nobody offers has no price,
        // and sorting it to the top of "cheapest first" is the wrong answer in
        // the most visible possible place.
        return sql`d.min_price_amount ASC NULLS LAST, ${tiebreak}`;
      case 'price_desc':
        return sql`d.min_price_amount DESC NULLS LAST, ${tiebreak}`;
      case 'newest':
        return tiebreak;
      default:
        // Every sort ends with the product id, for the same reason the buy box
        // does: without a total order, equally-ranked rows swap between requests
        // and paging repeats or skips them.
        return sql`${this.rankExpression(query)} DESC, ${tiebreak}`;
    }
  }

  // --------------------------------------------------------------------- facets

  /**
   * Total and every facet in ONE pass over the matched set, wherever possible.
   *
   * A facet dimension excludes its own filter from its counts, so in general
   * each dimension needs a different predicate. But a dimension the caller has
   * NOT filtered has nothing to exclude - its predicate IS the base predicate -
   * and that is the common case. Those are aggregated together from a single
   * MATERIALIZED scan; only a dimension with an active filter costs a second
   * pass.
   *
   * This is where the phase's performance criterion was won. Seven separate
   * evaluations of a predicate matching 50k rows measured p95 = 312 ms against
   * a 300 ms budget; one scan plus at most a couple of extras brings it well
   * inside. The counts are unchanged - same predicate, same rows, computed once
   * instead of seven times.
   */
  private async aggregate(
    tx: Transaction,
    query: SearchQuery,
    base: SQL,
  ): Promise<{ total: number; facets: Facets }> {
    const shared = await tx.execute<{ dim: string; value: string | null; count: number }>(sql`
      WITH m AS MATERIALIZED (
        SELECT d.category_slug, d.brand, d.in_stock, d.min_price_amount
        FROM search_documents d
        WHERE ${base}
      )
      SELECT 'total' AS dim, NULL::text AS value, count(*)::int AS count FROM m
      UNION ALL
      SELECT 'category', m.category_slug, count(*)::int FROM m GROUP BY m.category_slug
      UNION ALL
      SELECT 'brand', m.brand, count(*)::int FROM m WHERE m.brand IS NOT NULL GROUP BY m.brand
      UNION ALL
      SELECT 'availability', m.in_stock::text, count(*)::int FROM m GROUP BY m.in_stock
      UNION ALL
      SELECT 'price', ${priceBucketExpression()}, count(*)::int FROM m GROUP BY 2
    `);

    const total = shared.rows.find((r) => r.dim === 'total')?.count ?? 0;
    const grouped = (dim: string): Map<string, number> =>
      new Map(shared.rows.filter((r) => r.dim === dim).map((r) => [r.value ?? '', r.count]));

    // A dimension the caller HAS filtered needs its own pass, because its
    // counts must ignore that filter to stay drillable.
    const categoryCounts =
      query.category === undefined
        ? grouped('category')
        : await this.countBy(tx, query, 'category', sql`d.category_slug`);
    const brandCounts =
      query.brand === undefined
        ? grouped('brand')
        : await this.countBy(tx, query, 'brand', sql`d.brand`);
    const availabilityCounts =
      query.inStock === undefined
        ? grouped('availability')
        : await this.countBy(tx, query, 'inStock', sql`d.in_stock::text`);
    const priceCounts =
      query.minPrice === undefined && query.maxPrice === undefined
        ? grouped('price')
        : await this.countBy(tx, query, 'price', priceBucketExpression());

    return {
      total,
      facets: {
        category: await this.labelCategories(tx, categoryCounts),
        brand: [...brandCounts.entries()]
          .map(([value, count]) => ({ value, label: value, count }))
          .sort(byCountThenValue),
        availability: [
          { value: 'in_stock', label: 'In stock', count: availabilityCounts.get('true') ?? 0 },
          {
            value: 'out_of_stock',
            label: 'Out of stock',
            count: availabilityCounts.get('false') ?? 0,
          },
        ],
        price: PRICE_BUCKETS.map((bucket) => ({
          value: bucket.value,
          label: bucket.label,
          count: priceCounts.get(bucket.value) ?? 0,
        })),
        attributes: await this.attributeFacets(tx, query),
      },
    };
  }

  /** One dimension, counted with every filter applied EXCEPT its own. */
  private async countBy(
    tx: Transaction,
    query: SearchQuery,
    dimension: FacetDimension,
    value: SQL,
  ): Promise<Map<string, number>> {
    const where = this.buildPredicate(query, dimension);
    const rows = await tx.execute<{ value: string | null; count: number }>(sql`
      SELECT ${value} AS value, count(*)::int AS count
      FROM search_documents d WHERE ${where} GROUP BY 1
    `);
    return new Map(
      rows.rows.filter((r) => r.value !== null).map((r) => [r.value as string, r.count]),
    );
  }

  /**
   * Category names, looked up separately.
   *
   * A join inside the aggregate above would drag `categories` into the
   * materialised scan for no benefit: there are a few dozen categories and the
   * lookup is a millisecond, whereas widening the CTE costs a column on every
   * matched row.
   */
  private async labelCategories(
    tx: Transaction,
    counts: Map<string, number>,
  ): Promise<FacetValue[]> {
    if (counts.size === 0) return [];
    const rows = await tx.execute<{ slug: string; name: string }>(
      sql`SELECT slug, name FROM categories`,
    );
    const names = new Map(rows.rows.map((r) => [r.slug, r.name]));
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: names.get(value) ?? value, count }))
      .sort(byCountThenValue);
  }

  /**
   * PRD 9.1's per-category dynamic facets: screen size for phones, size for
   * clothing.
   *
   * Only offered when the search is scoped to a category, because the union of
   * every category's attributes is a filter list nobody can read - and only for
   * attributes the category marked `is_facetable`, which is the column that
   * distinguishes "screen size" from "box contents".
   */
  private async attributeFacets(
    tx: Transaction,
    query: SearchQuery,
  ): Promise<Facets['attributes']> {
    if (query.category === undefined) return [];
    const where = this.buildPredicate(query, 'attributes');

    const definitions = await tx.execute<{ key: string; label: string }>(sql`
      SELECT ca.key, ca.label
      FROM category_attributes ca
      JOIN categories c ON c.id = ca.category_id
      WHERE c.slug = ${query.category} AND ca.is_facetable = TRUE AND ca.datatype = 'TEXT'
      ORDER BY ca.key
    `);

    const out: Facets['attributes'] = [];
    for (const definition of definitions.rows) {
      const rows = await tx.execute<{ value: string; count: number }>(sql`
        SELECT pa.value_text AS value, count(*)::int AS count
        FROM search_documents d
        JOIN product_attributes pa ON pa.product_id = d.product_id AND pa.key = ${definition.key}
        WHERE ${where} AND pa.value_text IS NOT NULL
        GROUP BY pa.value_text
        ORDER BY count DESC, value ASC
      `);
      if (rows.rows.length > 0) {
        out.push({
          key: definition.key,
          label: definition.label,
          values: rows.rows.map((r) => ({ value: r.value, label: r.value, count: r.count })),
        });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- suggestions

  /** PRD 9.1 autocomplete. Prefix first, then typo-tolerant, never both twice. */
  async suggest(term: string, limit: number): Promise<{ slug: string; name: string }[]> {
    return this.run(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(WORD_SIMILARITY_THRESHOLD)}, true)`,
      );
      const rows = await tx.execute<{ slug: string; name: string }>(sql`
        SELECT slug, name FROM search_documents
        WHERE name ILIKE ${term + '%'} OR ${term}::text <% name
        -- Prefix matches first: someone who has typed three letters of the right
        -- word wants the completion, not the nearest neighbour of a word they
        -- have not finished.
        ORDER BY (name ILIKE ${term + '%'}) DESC, word_similarity(${term}::text, name) DESC, name ASC
        LIMIT ${limit}
      `);
      return rows.rows;
    });
  }

  /**
   * PRD 9.1 "similar products".
   *
   * Same category, ranked by how many attribute values they share. Real, cheap,
   * and computed from data Phase 2 already produced.
   *
   * "Frequently bought together" is NOT here. It needs order history, which is
   * Phase 4, and a random sample presented as a recommendation would be worse
   * than its absence.
   */
  async similar(slug: string, limit: number): Promise<SearchHit[]> {
    return this.run(async (tx) => {
      const target = await tx.execute<{ product_id: string; category_id: string }>(
        sql`SELECT product_id, category_id FROM search_documents WHERE slug = ${slug}`,
      );
      const row = target.rows[0];
      if (row === undefined) throw new NotFoundException('No such product');

      const rows = await tx.execute<{
        product_id: string;
        slug: string;
        name: string;
        brand: string | null;
        category_slug: string;
        min_price_amount: string | null;
        price_currency: string | null;
        seller_count: number;
        in_stock: boolean;
        product_created_at: Date;
      }>(sql`
        SELECT d.product_id, d.slug, d.name, d.brand, d.category_slug,
               d.min_price_amount, d.price_currency, d.seller_count, d.in_stock,
               d.product_created_at,
               (SELECT count(*) FROM product_attributes a
                 JOIN product_attributes b ON b.key = a.key AND b.value_text IS NOT DISTINCT FROM a.value_text
                WHERE a.product_id = d.product_id AND b.product_id = ${row.product_id}) AS shared
        FROM search_documents d
        WHERE d.category_id = ${row.category_id} AND d.product_id <> ${row.product_id}
        ORDER BY shared DESC, d.product_created_at DESC, d.product_id DESC
        LIMIT ${limit}
      `);
      return rows.rows.map(toHit);
    });
  }
}

/**
 * Fixed buckets rather than a computed histogram.
 *
 * A histogram whose boundaries move with the result set means the same filter
 * means something different after every search, so a saved search or a shared
 * URL stops reproducing. Fixed buckets are less pretty and they round-trip.
 */
function priceBucketExpression(): SQL {
  const cases = PRICE_BUCKETS.map((bucket) =>
    bucket.max === null
      ? sql`WHEN min_price_amount >= ${bucket.min} THEN ${bucket.value}`
      : sql`WHEN min_price_amount >= ${bucket.min} AND min_price_amount < ${bucket.max} THEN ${bucket.value}`,
  );
  return sql`(CASE ${sql.join(cases, sql` `)} ELSE NULL END)`;
}

function byCountThenValue(a: FacetValue, b: FacetValue): number {
  // Most common first, then alphabetical - so a facet list is stable between
  // requests even when two values tie.
  return b.count - a.count || a.value.localeCompare(b.value);
}

type HitRow = {
  product_id: string;
  slug: string;
  name: string;
  brand: string | null;
  category_slug: string;
  min_price_amount: string | number | null;
  price_currency: string | null;
  seller_count: number;
  in_stock: boolean;
  /**
   * A raw `tx.execute` does not go through Drizzle's column mapping, so a
   * timestamptz can arrive as a string rather than a Date depending on the
   * driver's type parsers. Typed as both and normalised below, because the one
   * place it mattered - encodeCursor calling toISOString - only runs when a
   * result set is large enough to page, so a Date assumption survives every
   * small test and fails on the first real one.
   */
  product_created_at: Date | string;
};

function toHit(row: HitRow): SearchHit {
  return {
    productId: row.product_id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    categorySlug: row.category_slug,
    // bigint comes back from node-postgres as a string, so it is parsed here
    // rather than left to whatever the JSON serialiser does with it. A price
    // that reaches a client as "3860000" instead of 3860000 sorts as text.
    price:
      row.min_price_amount === null || row.price_currency === null
        ? null
        : { amount: Number(row.min_price_amount), currency: row.price_currency.trim() },
    sellerCount: row.seller_count,
    inStock: row.in_stock,
    createdAt: new Date(row.product_created_at),
  };
}
