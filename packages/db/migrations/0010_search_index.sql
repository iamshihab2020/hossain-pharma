-- Phase 3 discovery: the one definition of a search document, and the indexes
-- that make it fast.
--
-- THE VIEW IS THE POINT. `search_documents` is a materialisation, and a
-- materialisation with two definitions - one for the incremental update and one
-- for the full rebuild - drifts the first time somebody edits only one of them.
-- Both paths in SearchIndexService are
--   INSERT INTO search_documents SELECT ... FROM search_document_source ...
-- so there is exactly one answer to "what is a document", and the drift test
-- compares the table against this view row for row.
--
-- READING THIS VIEW REQUIRES NO TENANT CONTEXT, and that is not incidental.
-- `listings` is tenant-isolated, so evaluating this with a tenant selected
-- would compute "the cheapest offer" from that one seller's rows and write a
-- confidently wrong number. The reindex therefore clears app.tenant_id for the
-- duration of the statement (see withoutTenantScope in the API), which makes
-- `public_active_offers` the governing policy - ACTIVE offers from every
-- seller, which is exactly what a cross-tenant aggregate needs and all it needs.

CREATE OR REPLACE VIEW search_document_source AS
SELECT
  p.id                AS product_id,
  p.slug              AS slug,
  p.name              AS name,
  p.brand             AS brand,
  c.id                AS category_id,
  c.slug              AS category_slug,
  c.path              AS category_path,

  -- The plain text the trigram operator matches against. Kept alongside the
  -- tsvector rather than derived from it: `tsv` is stemmed and lexeme-split, so
  -- similarity() over it would compare stems and score a human's typo worse
  -- than comparing the words they actually typed.
  concat_ws(' ',
    p.name,
    p.brand,
    c.name,
    (SELECT string_agg(a.value_text, ' ')
       FROM product_attributes a
      WHERE a.product_id = p.id AND a.value_text IS NOT NULL)
  )                   AS search_text,

  -- Weighted, per PRD 10.2. A hit in the name outranks a hit in the
  -- description, which is the difference between searching a catalogue and
  -- grepping it.
  --
  -- 'english' appears in this file and nowhere else. PRD 10.6 owns i18n, and a
  -- Bangla analyser is a change to these five lines plus a reindex - which is
  -- exactly why the analyser name is not scattered across the application.
  (
    setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(p.brand, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(c.name, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(a.value_text, ' ')
         FROM product_attributes a
        WHERE a.product_id = p.id AND a.value_text IS NOT NULL), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(p.description, '')), 'D')
  )                   AS tsv,

  offers.min_price    AS min_price_amount,
  offers.currency     AS price_currency,
  coalesce(offers.seller_count, 0) AS seller_count,
  coalesce(offers.seller_count, 0) > 0 AS in_stock,

  p.created_at        AS product_created_at,
  now()               AS indexed_at
FROM products p
JOIN categories c ON c.id = p.category_id
LEFT JOIN LATERAL (
  SELECT
    min(e.landed)                                   AS min_price,
    -- The currency OF THE CHEAPEST OFFER, not min(currency). Two aggregates
    -- computed independently can name a price from one row and a currency from
    -- another, which is a wrong number that looks right. A product whose offers
    -- genuinely differ in currency is a PRD 10.6 problem; this at least reports
    -- a pair that came from the same listing.
    (array_agg(e.currency ORDER BY e.landed))[1]    AS currency,
    -- DISTINCT tenant. A seller offering two variants of one product is one
    -- seller, and "3 sellers" over two of them plus a rival is a number that
    -- reads as competition where there is less of it. PRD 9.1 renders this as
    -- "N other sellers from X", so it has to mean sellers.
    count(DISTINCT e.tenant_id)::int                AS seller_count
  FROM (
    -- ELIGIBILITY IS THE BUY BOX'S RULE, restated here so the two cannot
    -- disagree: an ACTIVE listing, an ACTIVE seller, stock above zero. A search
    -- result offering a price the product page will not honour is worse than a
    -- result that is missing.
    --
    -- `landed` is item plus flat shipping, for the same reason the buy box ranks
    -- on it. Phase 6 replaces the flat figure with a zone quote, and this
    -- expression is where that lands.
    SELECT
      coalesce(li.sale_price_amount, li.price_amount) + li.shipping_amount AS landed,
      li.price_currency AS currency,
      li.tenant_id AS tenant_id
    FROM listings li
    JOIN product_variants v ON v.id = li.variant_id
    JOIN organisations o ON o.id = li.tenant_id
    WHERE v.product_id = p.id
      AND li.status = 'ACTIVE'
      AND o.status = 'ACTIVE'
      AND li.available_stock > 0
  ) e
) offers ON TRUE
-- Only published products are searchable. A DRAFT or PENDING_REVIEW entry has
-- no public page, so a search result linking to a 404 would be the only way to
-- discover what sellers have proposed.
WHERE p.status = 'ACTIVE';
--> statement-breakpoint

-- GIN over the tsvector: the full-text half of the predicate.
CREATE INDEX IF NOT EXISTS search_documents_tsv_idx ON "search_documents" USING gin (tsv);
--> statement-breakpoint

-- GIN over trigrams: the typo-tolerant half. Without this the `%` operator is a
-- sequential scan over every row, and the 50k-product p95 budget is gone.
CREATE INDEX IF NOT EXISTS search_documents_trgm_idx ON "search_documents" USING gin (search_text gin_trgm_ops);
--> statement-breakpoint

-- Autocomplete matches on the name specifically, so it gets its own trigram
-- index rather than sharing the one over the whole search text.
CREATE INDEX IF NOT EXISTS search_documents_name_trgm_idx ON "search_documents" USING gin (name gin_trgm_ops);
--> statement-breakpoint

-- search_documents, recently_viewed and saved_searches carry NO row-level
-- security, and that is a decision.
--
-- search_documents describes ACTIVE products that already have a public page,
-- and every aggregate on it - the cheapest landed price, the number of sellers,
-- whether anything is in stock - is computed from offers that are themselves
-- public. Per-warehouse stock, DRAFT prices and paused offers never reach it.
--
-- recently_viewed and saved_searches are platform-owned (PRD 6.2): buyers are
-- not tenants. They carry a user id and are scoped by the authenticated caller
-- in the service, which is exactly how `sessions` is handled.
GRANT SELECT, INSERT, UPDATE, DELETE ON "search_documents" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recently_viewed" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "saved_searches" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT ON search_document_source TO nexmarket_app;
