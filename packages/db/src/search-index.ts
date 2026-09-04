import { sql, type SQL } from 'drizzle-orm';

/**
 * The statements that maintain `search_documents`, in one place.
 *
 * They live in `packages/db` rather than in the API because the SEED has to
 * build the index too, and a seed with its own copy of the insert is a second
 * definition that drifts. The view in migration 0010 defines what a document
 * is; this defines how it gets into the table; `SearchIndexService` decides
 * when, and is responsible for clearing the tenant scope first.
 *
 * EVERY ONE OF THESE MUST RUN WITH NO TENANT SELECTED. `listings` is
 * tenant-isolated, so evaluating the view with a tenant selected computes "the
 * cheapest offer" from that one seller's rows and writes a confidently wrong
 * number. The API wraps them in `withoutTenantScope`; the seed already runs
 * with `tenantId: null`.
 */
const COLUMNS = sql`
  product_id, slug, name, brand, category_id, category_slug, category_path,
  search_text, tsv, min_price_amount, price_currency, seller_count, in_stock,
  product_created_at, indexed_at
`;

const UPDATES = sql`
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  category_id = EXCLUDED.category_id,
  category_slug = EXCLUDED.category_slug,
  category_path = EXCLUDED.category_path,
  search_text = EXCLUDED.search_text,
  tsv = EXCLUDED.tsv,
  min_price_amount = EXCLUDED.min_price_amount,
  price_currency = EXCLUDED.price_currency,
  seller_count = EXCLUDED.seller_count,
  in_stock = EXCLUDED.in_stock,
  product_created_at = EXCLUDED.product_created_at,
  indexed_at = EXCLUDED.indexed_at
`;

/** Upserts one product's document from the view. */
export function upsertSearchDocument(productId: string): SQL {
  return sql`
    INSERT INTO search_documents (${COLUMNS})
    SELECT ${COLUMNS} FROM search_document_source WHERE product_id = ${productId}
    ON CONFLICT (product_id) DO UPDATE SET ${UPDATES}
  `;
}

/**
 * Removes a document the view no longer produces.
 *
 * A product that leaves ACTIVE stops appearing in `search_document_source`, so
 * the upsert above writes nothing and the stale row would survive - a search
 * result linking to a page that 404s. Paired with the upsert on every call, so
 * no caller has to know which of the two applies.
 */
export function pruneSearchDocument(productId: string): SQL {
  return sql`
    DELETE FROM search_documents
    WHERE product_id = ${productId}
      AND NOT EXISTS (SELECT 1 FROM search_document_source s WHERE s.product_id = ${productId})
  `;
}

/** Reindexes every product a tenant lists - what a seller's suspension changes. */
export function upsertSearchDocumentsForTenant(tenantId: string): SQL {
  return sql`
    INSERT INTO search_documents (${COLUMNS})
    SELECT ${COLUMNS} FROM search_document_source
    WHERE product_id IN (
      SELECT DISTINCT v.product_id FROM listings l
      JOIN product_variants v ON v.id = l.variant_id
      WHERE l.tenant_id = ${tenantId}
    )
    ON CONFLICT (product_id) DO UPDATE SET ${UPDATES}
  `;
}

/**
 * Rebuilds the whole index.
 *
 * Delete-and-fill rather than upsert-and-prune: a rebuild runs because the
 * document DEFINITION changed, so every row is being replaced anyway, and doing
 * it in one transaction means readers see the old index or the new one, never a
 * half-built one.
 */
export const deleteAllSearchDocuments: SQL = sql`DELETE FROM search_documents`;

export const insertAllSearchDocuments: SQL = sql`
  INSERT INTO search_documents (${COLUMNS})
  SELECT ${COLUMNS} FROM search_document_source
`;
