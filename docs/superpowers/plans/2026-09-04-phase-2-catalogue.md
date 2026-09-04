# Phase 2 — Catalogue Implementation Plan

**Spec:** `docs/PRD-marketplace-migration.md` §8.3, §9.1 (product page), §9.2 (catalogue
management), §11 Phase 2.

**Acceptance (PRD §11):** two sellers list the same product at different prices; the
product page shows both with a correct buy-box winner. RLS blocks seller A from editing
seller B's listing.

**Demo:** two sellers compete on one product page; the cheaper landed price wins the buy
box.

---

## Global Constraints

Unchanged from Phase 1 and repeated because they are the things that break silently:

- **Never import `db` or `pool`.** Services take their transaction from
  `getRequestContext()`. A lint rule enforces the import ban.
- **Every new tenant-owned table needs `ENABLE` + `FORCE` + policies in a hand-written
  migration**, created with `drizzle-kit generate --custom` so the file, the journal
  entry and the snapshot are written together.
- **Missing tenant context returns zero rows.** `NULLIF(current_setting(...), '')::uuid`
  is mandatory.
- **Money is integer minor units.** No floats in any price, discount or shipping path.
  Columns are `bigint` + a `char(3)` currency.
- **All relative imports carry `.js`.** ESM everywhere.
- **Namespace test emails and slugs per test file.** The API suite shares one database
  across parallel files.
- Four gates must pass: `pnpm lint && pnpm type-check && pnpm test && pnpm build`.

---

## Phase 2 scoping decisions

### P-A. Category paths use `ltree`, created by a migration

PRD §8.1 specifies `categories` as "self-referencing + `path` ltree". Verified present:
`postgres:16-alpine` ships `ltree 1.2` and `pg_trgm 1.6`, which is the same image
Testcontainers and `docker compose` both use, so no environment diverges.

`CREATE EXTENSION` needs rights the app role deliberately lacks, so it happens in a
migration on `DATABASE_MIGRATION_URL` like every other DDL statement. Drizzle has no
`ltree` column type; a `customType` maps it, and the *only* thing the application does
with it is `path <@ $1` for subtree queries and `nlevel(path)` for the depth check.

Rejected: a `text` path with `/` separators. It works for three levels and reimplements
subtree matching in the application, which is the class of thing this project moves into
the database on purpose.

### P-B. Buy box is computed at read time, and Phase 2's "landed price" is honest about what it excludes

PRD §8.3 ranks by *landed* price — price plus shipping to the buyer's zone. Delivery
zones are Phase 6. Phase 2 therefore ranks by `price + listing.shipping_amount`, a flat
per-listing figure, and **says so in the response**: the buy-box payload carries
`basis: 'flat-shipping'` so a client cannot mistake it for a zone-aware quote.

Seller rating is the second key and there are no reviews until Phase 7, so it is
constant — recorded rather than silently skipped.

The final tiebreaker is `listing.id`. Without a total order the winner flickers between
equal offers on every request, which reads as a bug and is unreproducible.

Not materialised: a `buy_box_winner` column is a cache that goes stale on every price and
stock change, and Phase 2 has no invalidation story. Phase 3 materialises
`search_documents` and is the right place to revisit it.

### P-C. Listings are moderated only where the category is `RESTRICTED`

PRD §9.2 gives listings `DRAFT → PENDING_REVIEW → ACTIVE ⇄ PAUSED → ARCHIVED`, and
§9.2 also says product *proposals* are admin-moderated. If every listing needed review,
`PENDING_REVIEW` would be a queue the platform cannot staff; if none did, the state would
be dead.

So: a listing in a `RESTRICTED` category must go `DRAFT → PENDING_REVIEW → ACTIVE` and an
admin approves it. Everything else may self-publish `DRAFT → ACTIVE`. This gives the
`RESTRICTED` flag a job in the phase that introduces it, rather than waiting for the
Phase 4 age gate.

### P-D. `warehouses` arrives here, minimally

`inventory_items` is Phase 2 scope in PRD §11 and is keyed by warehouse. PRD §9.2
onboarding step 5 ("at least one pickup location with pincode") is Phase 1 scope that
Phase 1 did not build — recorded here rather than left as a hole.

Phase 2 adds `warehouses` as a tenant-owned table with `name` and `pincode` and nothing
else. Zones, rate cards, slots and serviceability stay in Phase 6. A listing cannot reach
`ACTIVE` without stock in at least one warehouse.

### P-E. Attributes are a typed EAV table, not JSONB

PRD §8.1 lists `product_attributes` and `category_attributes` as tables. Phase 3 needs
per-category facets with exact counts, and a `GROUP BY value_text` over an indexed column
is a query; the JSONB equivalent is a query plus a decision about which paths to index.

`category_attributes` defines the schema (key, label, datatype, required, facetable);
`product_attributes` holds one row per product per key, with `value_text`, `value_number`
and `value_bool` and a check constraint that exactly one is set.

### P-F. Products are platform-owned; listings are tenant-owned

`products`, `product_variants`, `product_media`, `product_attributes`, `categories` and
`category_attributes` carry **no `tenant_id` and no RLS** — a catalogue entry shared by
competing sellers is the entire point of §8.3. Writes are guarded by
`@PlatformAdmin()` or by the proposal flow.

`listings`, `inventory_items` and `warehouses` are tenant-owned with `ENABLE` + `FORCE` +
the three policies.

`products.proposed_by` records which organisation proposed an entry, for moderation. It
is **not** a tenant column and confers no ownership.

---

## File Structure

```
packages/db/src/schema/
├── categories.ts          NEW  categories (ltree path), category_attributes
├── products.ts            NEW  products, product_variants, product_media, product_attributes
├── listings.ts            NEW  listings, inventory_items
├── warehouses.ts          NEW  warehouses (tenant-owned)
└── index.ts               MOD  re-export

packages/db/src/seed/
├── categories.ts          NEW  3 levels, one PERISHABLE and one RESTRICTED
├── products.ts            NEW  catalogue entries with variants and attributes
├── listings.ts            NEW  TWO sellers on ONE product at different prices
└── index.ts               MOD  wire in dependency order

packages/db/migrations/
├── 0007_catalogue_tables.sql       NEW  generated
├── 0008_catalogue_rls.sql          NEW  --custom: ltree extension, ENABLE+FORCE, policies, grants

packages/shared/src/
├── buy-box.ts             NEW  ranking, framework-free, 100% covered
└── buy-box.test.ts        NEW

apps/api/src/modules/
├── catalogue/             NEW  categories, products, the public product page
└── listings/              NEW  seller listing CRUD, inventory, warehouses

apps/api/test/
├── catalogue.e2e.test.ts  NEW  product page, buy box, moderation
└── listings.e2e.test.ts   NEW  seller CRUD, the RLS acceptance test
```

---

## Task 1: Catalogue schema

**Files:** the four new `schema/*.ts`, `schema/index.ts`, migration `0007`.

- [ ] `categories`: `id`, `parentId` (self-ref, `set null`), `slug` unique, `name`,
      `path` (ltree), `isPerishable`, `isRestricted`, `createdAt`. Depth is capped at 3
      by a check on `nlevel(path)` in the RLS migration.
- [ ] `category_attributes`: `id`, `categoryId`, `key`, `label`, `datatype`
      (`TEXT|NUMBER|BOOL`), `isRequired`, `isFacetable`, unique `(categoryId, key)`.
- [ ] `products`: `id`, `categoryId`, `slug` unique, `name`, `brand`, `description`,
      `status` (`DRAFT|PENDING_REVIEW|ACTIVE|REJECTED|ARCHIVED`), `proposedBy` (uuid, no
      FK — same cycle-avoidance as `organisations.reviewedBy`), `reviewedBy`,
      `reviewedAt`, `reviewNote`, timestamps.
- [ ] `product_variants`: `id`, `productId`, `sku` unique, `name`, `barcode`, `position`.
- [ ] `product_media`: `id`, `productId`, `storageKey`, `contentType`,
      `originalFilename`, `altText`, `position`.
- [ ] `product_attributes`: `id`, `productId`, `key`, `valueText`, `valueNumber`,
      `valueBool`, unique `(productId, key)`, plus a check that exactly one value column
      is non-null.
- [ ] `warehouses`: `id`, `tenantId`, `name`, `pincode`, `isDefault`, `createdAt`.
- [ ] `listings`: `id`, `tenantId`, `variantId`, `status`
      (`DRAFT|PENDING_REVIEW|ACTIVE|PAUSED|ARCHIVED`), `priceAmount` (bigint),
      `priceCurrency` (char 3), `salePriceAmount`, `shippingAmount`, `dispatchDays`,
      `condition`, `reviewedBy`/`reviewedAt`/`reviewNote`, timestamps, unique
      `(tenantId, variantId)` — one offer per seller per variant.
- [ ] `inventory_items`: `id`, `tenantId`, `listingId`, `warehouseId`, `onHand`,
      `reserved`, `lowStockThreshold`, unique `(listingId, warehouseId)`.

Generate with `drizzle-kit generate` (not `--custom`).

## Task 2: The RLS migration

**File:** `0008_catalogue_rls.sql`, hand-written with `--custom`.

- [ ] `CREATE EXTENSION IF NOT EXISTS ltree;`
- [ ] `ALTER TABLE categories ADD CONSTRAINT categories_max_depth CHECK (nlevel(path) <= 3);`
- [ ] `ENABLE` + **`FORCE`** on `listings`, `inventory_items`, `warehouses`.
- [ ] `tenant_isolation` and `platform_admin_bypass` on all three, with the
      `NULLIF(..., '')::uuid` wrapper.
- [ ] `GRANT SELECT, INSERT, UPDATE, DELETE` on every new table to `nexmarket_app`.
- [ ] **No policy on the catalogue tables.** Add a comment saying that is deliberate.
- [ ] Index `categories USING gist (path)`, and `listings (variant_id)` — the buy-box
      query's driving predicate.

Then extend `packages/db/src/migrations.test.ts`? No — it already asserts the journal
matches the disk. Extend `membership-rls.test.ts`'s FORCE test to include the three new
tables, and add cross-tenant listing tests.

## Task 3: The buy box, as a pure function

**Files:** `packages/shared/src/buy-box.ts`, `buy-box.test.ts`.

- [ ] `type Offer = { listingId, tenantId, price: Money, shipping: Money, dispatchDays, availableStock, sellerRating, listingStatus, sellerStatus }`
- [ ] `eligible(offer)` — ACTIVE listing, ACTIVE-or-SUSPENDED seller… **no**: a suspended
      seller keeps fulfilment and loses selling (PRD §6.6), so a suspended seller's
      listings are **ineligible**. Stock must be > 0.
- [ ] `rankOffers(offers): { winner, others }` — landed price asc, seller rating desc,
      dispatch days asc, stock desc, listing id asc.
- [ ] Currency mixing throws rather than comparing across currencies.
- [ ] 100% coverage, added to `packages/shared/vitest.config.ts` thresholds.

Tests must include: the acceptance case (two sellers, different prices, cheaper wins),
shipping flipping the winner, an out-of-stock cheaper offer losing, a suspended seller
excluded, and a deterministic result for two identical offers.

## Task 4: Seed the acceptance case

**Files:** `seed/categories.ts`, `seed/products.ts`, `seed/listings.ts`, `seed/index.ts`.

- [ ] Three category levels, one branch flagged `PERISHABLE` and one `RESTRICTED`.
- [ ] At least one product with two variants and category attributes filled in.
- [ ] **The same variant listed by acme-electronics and northwind-home at different
      prices**, both ACTIVE with stock — this is the PRD acceptance fixture, and it must
      be in the seed rather than invented per test.
- [ ] Listings and inventory are written through `withTenant`, for the Phase 1 reason: a
      plain insert writes zero rows and throws nothing.
- [ ] Idempotent. Seed twice, identical summary.

## Task 5: Seller listing CRUD

**Files:** `apps/api/src/modules/listings/`.

- [ ] `POST /listings` (`product:write`), `PATCH /listings/:id`, `POST /listings/:id/publish`,
      `/pause`, `/archive`, `GET /listings` (cursor-paginated, `product:read`).
- [ ] `POST /warehouses`, `GET /warehouses`, `PUT /listings/:id/inventory`.
- [ ] The transitions table pattern from `modules/orgs/lifecycle.ts`.
- [ ] Publish refuses without stock, and routes a `RESTRICTED` category to
      `PENDING_REVIEW` instead of `ACTIVE` (P-C).
- [ ] **The acceptance test:** seller A cannot `PATCH` seller B's listing. Both the
      403 from the id/tenant check *and* the zero-rows RLS result must be proven, because
      closing one and leaving the other is the mistake.

## Task 6: The catalogue read surface and the buy box

**Files:** `apps/api/src/modules/catalogue/`.

- [ ] `GET /categories` (tree), `GET /categories/:slug/products`.
- [ ] `GET /products/:slug` — the product page: variants, media, attributes, and the
      **offer table with the buy-box winner**.
- [ ] These are `@Public()`. A marketplace product page that needs a login is not a
      marketplace product page — and this is the first public read surface, so the
      allowlist in `route-coverage.e2e.test.ts` grows and each entry needs its reason.
- [ ] The offer query reads `listings` **with no tenant context**. Tenant-owned rows are
      invisible without it, so the public read needs a policy: add `public_active_offers`
      to `listings`, `FOR SELECT`, `USING (status = 'ACTIVE')`. Write down that this is
      the one table where a public read is intended, and that it exposes only ACTIVE rows.

## Task 7: Admin product moderation

**Files:** extend `apps/api/src/modules/admin/`.

- [ ] `GET /admin/products?status=PENDING_REVIEW` (cursor-paginated),
      `POST /admin/products/:id/approve`, `/reject`.
- [ ] `POST /admin/listings/:id/approve`, `/reject` for the `RESTRICTED` queue.
- [ ] Reuse `pagination.ts` and the `transition` shape from `AdminService`.

## Task 8: Media upload

- [ ] `POST /products/:id/media` through the Phase 1 `FileStorage` port, `@PlatformAdmin()`.
- [ ] Same rules: the storage key contains no part of the filename, `storageKey` is never
      in a response.

## Task 9: Gates, evidence, documentation

- [ ] Four gates, counts recorded, no rounding.
- [ ] Extend the CI spin-up job with the Phase 2 seed counts.
- [ ] ADR: the buy box (P-B) and the public-read policy (Task 6) are the two decisions
      that will otherwise have to be re-derived.
- [ ] README and CLAUDE.md truth pass.

---

## Known gaps, stated rather than hidden

- **Landed price is flat, not zone-aware.** Phase 6 owns delivery zones; the response
  says `basis: 'flat-shipping'` so nothing downstream can assume otherwise.
- **Seller rating is constant.** No reviews until Phase 7, so the second ranking key does
  nothing yet. It is in the function and tested with synthetic ratings.
- **Bulk CSV import, tiered pricing, batch/lot expiry and FEFO** are PRD §9.2 catalogue
  items deliberately not in this phase. They are seller *tooling* (Phase 10) or depend on
  Phase 6 warehousing.
- **`reserved` stock is written but never decremented** — reservation happens at checkout,
  which is Phase 4. The column exists so `available = on_hand - reserved` is defined from
  the start rather than retrofitted.
