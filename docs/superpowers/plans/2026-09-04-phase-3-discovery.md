# Phase 3 — Discovery Implementation Plan

**Spec:** `docs/PRD-marketplace-migration.md` §9.1 (Discovery), §10.2 (Search), §11 Phase 3.

**Acceptance (PRD §11):** p95 < 300 ms on 50k products; typo tolerance verified;
**facet counts match filtered results exactly**.

**Demo:** search with a typo, filter by four facets including a category-specific one,
land on a product.

---

## Global Constraints

Unchanged, and repeated because they are what breaks silently:

- **Never import `db` or `pool`.** Public routes open their own
  `withTenant({ tenantId: null, ... })`, as the catalogue already does.
- **A second permissive policy on a tenant-owned table widens every tenant-scoped read.**
  Gate any new one on `NULLIF(current_setting('app.tenant_id', true), '') IS NULL`.
- **Never mutate seeded users or organisations in a test.** Register your own.
- Namespace test emails and slugs per file.
- Money is integer minor units, `bigint` + `char(3)`.
- Four gates must pass.

---

## Phase 3 scoping decisions

### D-A. `search_documents` is a table, and its definition lives in ONE view

PRD §8.1 and §11 both say "materialisation". The options were a materialized
view, a trigger-maintained table, and an application-maintained table.

- A **materialized view** cannot be refreshed incrementally; `REFRESH ...
  CONCURRENTLY` rebuilds all 50k rows to reflect one price change.
- **Triggers** cannot be forgotten, which is their whole appeal, but they are
  invisible from the call site and a trigger that fires inside an RLS-scoped
  transaction is a debugging problem this codebase does not need yet.
- An **application-maintained table** is the pattern `listings.available_stock`
  already uses, and it has one failure mode: a write path that forgets to
  reindex.

So: a real table, `search_documents`, plus a **view** `search_document_source`
that defines what a document *is*. `reindexProduct` is
`INSERT INTO search_documents SELECT * FROM search_document_source WHERE
product_id = $1 ON CONFLICT DO UPDATE`. The incremental path and the full
rebuild run the same definition, and the drift test compares table to view —
which is what turns "somebody forgot to reindex" from a silent staleness bug
into a red test.

### D-B. One predicate, used by both the results and the facet counts

The acceptance criterion is "facet counts match filtered results exactly". The
only way to guarantee that is for the counts and the results to be computed from
the same SQL predicate, in the same transaction.

So the query builder produces one `WHERE` fragment, and:

- the result page applies it plus paging;
- each facet dimension applies it **minus that dimension's own filter**, and
  groups.

Excluding a dimension from its own counts is the standard drill-down semantic:
with "Brand: Aurora" selected, the Brand facet still has to show how many
results *Samsung* would give, or the filter can never be changed. Applying all
filters to every facet would show zero for every unselected value, which is
"exact" and useless.

### D-C. Typo tolerance is FTS **or** trigram, in one predicate — not a fallback

The obvious design is "run FTS, and if it returns too little, run trigram
instead". Rejected: the two produce different result sets, so the facet counts
would describe a different query than the results, and the acceptance criterion
fails the moment a search is borderline.

Instead the predicate is `tsv @@ query OR search_text % query`, ranked by
`ts_rank_cd(...) + similarity(...)`. One predicate, one set of rows, counts that
match by construction. `pg_trgm`'s `%` operator uses the GIN index, so the OR is
not a sequential scan.

### D-D. Price and availability live in the document, and the reindex hooks are named

Sorting by price and filtering on availability have to work across 50k products
without joining every listing, so `search_documents` carries `min_price_amount`,
`seller_count` and `in_stock`, derived from eligible offers exactly as the buy
box defines eligible.

That means a **listing** change reindexes its **product**. The call sites are
finite and listed in Task 4; the drift test is what proves the list is complete.

### D-E. `recently_viewed` and `saved_searches` are platform-owned

Buyers are not tenants (PRD 6.2). Both tables carry `user_id` and no
`tenant_id`, both are RLS-free like `users`, and both are scoped in the
application by the authenticated user id — which is the same treatment
`sessions` gets.

Guests get recently-viewed in a cookie, not a row: PRD 9.1 says so, and writing
a row for an anonymous visitor means either a fake user id or a nullable
`user_id` that no policy can scope.

### D-F. Recommendations are honest about what they are

PRD 9.1 asks for "frequently bought together", "similar products" and "other
sellers for this item".

- **Other sellers for this item** already exists — it is the buy box.
- **Similar products** is same-category, shared-attribute overlap, ranked. Real,
  cheap, and computed from data Phase 2 produced.
- **Frequently bought together** needs orders, which are Phase 4. It is NOT
  implemented, and it is not faked with a random sample dressed up as a
  recommendation. Recorded as a gap.

---

## File Structure

```
packages/db/src/schema/
├── search.ts              NEW  search_documents, recently_viewed, saved_searches
└── index.ts               MOD

packages/db/migrations/
├── 0009_search_tables.sql NEW  generated
└── 0010_search_index.sql  NEW  --custom: pg_trgm, the source view, tsvector, GIN indexes, RLS

apps/api/src/modules/search/
├── search.service.ts      NEW  the one predicate, results + facets
├── search-index.service.ts NEW reindexProduct / reindexAll, the ONLY writer
├── suggest.service.ts     NEW  autocomplete
├── search.controller.ts   NEW  @Public() search, suggest, similar
├── discovery.controller.ts NEW recently-viewed, saved searches (authenticated)
└── dto.ts                 NEW

apps/api/test/
├── search.e2e.test.ts     NEW  typos, facets, sorting, the exactness criterion
└── search-perf.e2e.test.ts NEW 50k products, p95 < 300 ms
```

---

## Task 1: Schema and migrations

- [ ] `search_documents`: `productId` PK, `slug`, `name`, `brand`, `categoryId`,
      `categoryPath` (ltree), `searchText`, `tsv` (tsvector), `minPriceAmount`,
      `priceCurrency`, `sellerCount`, `inStock`, `productCreatedAt`, `indexedAt`.
- [ ] `recently_viewed`: `userId`, `productId`, `viewedAt`, unique `(userId, productId)`.
- [ ] `saved_searches`: `id`, `userId`, `name`, `query` (jsonb), `createdAt`.
- [ ] Migration `0010` (custom): `CREATE EXTENSION pg_trgm`; the
      `search_document_source` view; a GIN index on `tsv`; a GIN trgm index on
      `search_text`; grants. **No RLS on any of the three** — `search_documents`
      describes published catalogue data, and the two user tables are
      platform-owned and scoped by `user_id` in the service, exactly like
      `sessions`.

## Task 2: The document source view

One definition of a document, used by both reindex paths. Weighted:

```sql
setweight(to_tsvector('english', name), 'A') ||
setweight(to_tsvector('english', brand), 'B') ||
setweight(to_tsvector('english', category name), 'C') ||
setweight(to_tsvector('english', attribute values), 'C') ||
setweight(to_tsvector('english', description), 'D')
```

Only `products.status = 'ACTIVE'` produces a row. Price and stock come from
listings that are eligible **by the same rule the buy box uses** — ACTIVE
listing, ACTIVE seller, stock above zero.

## Task 3: `SearchIndexService`

- [ ] `reindexProduct(tx, productId)` — the only writer of `search_documents`.
- [ ] `reindexAll(tx)` — for a rebuild after a definition change.
- [ ] `removeProduct(tx, productId)` — a product that leaves ACTIVE leaves the index.

## Task 4: Wire the hooks, and prove the list is complete

Call `reindexProduct` from: product approve/reject/archive; listing
create/update/publish/pause/archive; inventory set. Then:

- [ ] **The drift test.** After exercising every mutation path over HTTP, assert
      `search_documents` equals `search_document_source` row for row. This is
      what makes the hook list verifiable rather than a claim.

## Task 5: Search, facets and sorting

- [ ] `GET /search?q=&category=&brand=&seller=&minPrice=&maxPrice=&inStock=&attr.<key>=&sort=&cursor=&limit=`
- [ ] Sorting: `relevance` (default), `price_asc`, `price_desc`, `newest`.
      Every sort ends with the product id, for the same reason the buy box does.
- [ ] Facets: category, brand, seller, price bucket, availability, and the
      **per-category attributes** whose `is_facetable` is true.
- [ ] Cursor pagination via the Phase 1 helper.

## Task 6: Autocomplete, browse, similar, recently viewed, saved searches

- [ ] `GET /search/suggest?q=` — prefix and trigram, capped, `@Public()`.
- [ ] `GET /products/:slug/similar` — same category, attribute overlap.
- [ ] `POST /products/:slug/viewed` and `GET /me/recently-viewed` — authenticated.
- [ ] `POST /me/saved-searches`, `GET`, `DELETE /:id`.

## Task 7: The acceptance evidence

- [ ] **Typo tolerance**: `aurroa`, `smartfone`, `merdian` all find their product.
- [ ] **Facet exactness**: for every facet value returned, applying it as a filter
      yields exactly that many results. Asserted in a loop, not spot-checked.
- [ ] **p95 < 300 ms on 50k products**: a dedicated suite that bulk-loads 50k
      products, ANALYZEs, runs 50 varied queries and asserts the 95th percentile.
      Report the measured figure; do not round it.

## Task 8: Gates, ADR, documentation

- [ ] Four gates, counts recorded.
- [ ] ADR: D-A (the view), D-B (one predicate), D-C (no fallback), D-F (the gap).
- [ ] README, CLAUDE.md, CI spin-up.

---

## Known gaps, stated rather than hidden

- **"Frequently bought together" is not implemented.** It needs order history,
  which is Phase 4. Faking it with a random sample would be worse than absent.
- **Saved-search alerts** (PRD 9.1 "with optional alerts") need the notification
  system, which is Phase 9. The searches are saved; nothing emails anyone.
- **Best-selling sort** needs orders. Absent for the same reason, and the sort
  enum does not offer it rather than offering it and returning something else.
- **Search is English-stemmed.** PRD 10.6 owns i18n; a Bangla analyser is a
  configuration change to the view plus a reindex, which is why the analyser
  name appears in exactly one place.
