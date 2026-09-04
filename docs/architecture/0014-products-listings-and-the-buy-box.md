# ADR 0014 - Products, listings, and the buy box

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 2
**Implements:** PRD 8.3, 9.1 (product page), 9.2 (catalogue management), 11 Phase 2.

## Context

The legacy schema had `products.email` — one product row per seller. Two sellers
offering the same handset produced two unrelated rows, so there was nothing to
compare and no buy box to build. PRD 8.3 calls the split the key marketplace
distinction, and Phase 2 is where it lands.

## Decision 1: `products` is platform-owned, `listings` is tenant-owned

A **product** is the catalogue entry, shared by every seller who offers it. A
**listing** is one seller's offer on one **variant** of it.

`categories`, `category_attributes`, `products`, `product_variants`,
`product_media` and `product_attributes` carry **no `tenant_id` and no RLS**. A
tenant policy on `products` would make the one-product-many-sellers page
impossible, which is the entire point of the phase. Writes are guarded at the
API by `@PlatformAdmin()` or by the proposal flow; migration 0008 says so in a
comment where someone would otherwise "fix" the omission.

`listings`, `inventory_items` and `warehouses` get `ENABLE` + `FORCE` + the
three policies.

Listings hang off a **variant**, not a product: "128GB violet at X" and "256GB
black at Y" are different offers, and a product-level listing cannot express
that. Every product gets at least one variant, including products with nothing
to vary — a nullable variant on `listings` would put a branch in every join
downstream.

`products.proposed_by` records which organisation asked for an entry, for the
moderation queue. **It is not a tenant column and confers no ownership.**

## Decision 2: `public_active_offers`, and the gate that keeps it honest

A marketplace product page shows every seller's offer to an anonymous visitor.
That read runs with no tenant context, and under `tenant_isolation` alone it
returns zero rows — correctly, and uselessly.

So `listings` carries a third policy: `FOR SELECT`, no `WITH CHECK`, restricted
to `status = 'ACTIVE'`.

**And gated on there being no tenant selected.** Postgres ORs permissive
policies, so without that gate a seller reading their own catalogue would also
match this policy and see every competitor's live prices mixed into their own
listing page. That is exactly the bug migration 0006 fixed on `org_members`, and
it is the *default* outcome of adding a second permissive policy to a
tenant-owned table. There is a test that fails when the gate is removed, and it
was run with the gate removed to confirm that it does.

**`inventory_items` is deliberately not public.** Exact per-warehouse stock is a
competitor's business intelligence.

## Decision 3: `listings.available_stock` is a denormalisation with one writer

The buy box has to exclude out-of-stock offers, and PRD 8.3 puts stock on the
offer — but an anonymous reader cannot see `inventory_items`. So the sum of
`on_hand - reserved` is kept on the listing.

`ListingsService.recomputeAvailableStock` is the only writer, and it runs in the
same transaction as the inventory write it summarises, so the two cannot diverge
across a failure. A seed test and an API test both assert they agree.

This is not the same call as refusing to materialise the buy-box winner. That is
a ranking over rows from many tenants that change independently with no
invalidation story; this is a sum over rows one service owns and updates
atomically.

The API reports availability as a **band** (`IN_STOCK` / `LOW_STOCK`), never the
number. PRD 9.1 asks for the band, and the number tells a competitor how fast a
rival is selling.

## Decision 4: the buy box is a pure function, computed at read time

`rankOffers` lives in `@nexmarket/shared`, framework-free, at 100% branch
coverage. It is the piece of Phase 2 most likely to be tuned, and tuning
something that needs a database and an HTTP request to exercise is how ranking
logic ends up untested.

Order: **landed price** ascending, then seller rating descending, then dispatch
days ascending, then stock depth descending, then **listing id** ascending.

- **The last key is not cosmetic.** Without a total order, two offers equal in
  every other field swap places between requests, so the buy box flickers and
  the winner on the page differs from the one add-to-cart resolves.
- **Ineligible offers are dropped, not ranked last.** An out-of-stock offer at a
  lower price is not an offer, and showing it as one invites the buyer to
  believe a price they cannot pay.
- **A SUSPENDED seller is excluded**, even though PRD 6.6 lets them keep
  fulfilling open orders. The two rules agree: finish what is sold, sell nothing
  new.
- **Mixed currencies throw.** A silent comparison of 100 BDT against 100 USD
  picks a winner and is wrong; PRD 10.6 owns multi-currency.

Not materialised into a `buy_box_winner` column: that is a cache that goes stale
on every price and stock change, and Phase 2 has no invalidation story. Phase 3
materialises `search_documents` and is the right place to revisit it.

### What "landed price" means in Phase 2, stated on the wire

PRD 8.3 ranks by price plus shipping **to the buyer's zone**. Delivery zones are
Phase 6. Phase 2 ranks on a flat per-listing shipping figure and the response
carries `basis: 'flat-shipping'`, so a client rendering "delivered price" can
tell that no address was quoted. Seller rating is the second key and there are
no reviews until Phase 7, so it is null for everyone and currently inert — it is
implemented and tested with synthetic values anyway, because a ranking key added
later, under time pressure, next to a live buy box is worse than one that is
already correct.

## Decision 5: category paths are `ltree`

`postgres:16-alpine` ships `ltree 1.2`, and that is the image both Testcontainers
and `docker compose` use, so no environment diverges. `CREATE EXTENSION` needs
rights the app role deliberately lacks, so it runs in migration 0007 on
`DATABASE_MIGRATION_URL` — prepended by hand to the generated file, because the
`categories` table cannot be created before the type exists and drizzle-kit
knows nothing about the extension its custom type needs.

Depth is capped at three by `CHECK (nlevel(path) <= 3)`: a property of the data,
enforced where the data lives. Browsing a parent uses `path <@ $1`, which is why
there is a GiST index — the alternative, collecting descendant ids in the
application, is a second query that goes stale mid-request.

## Decision 6: `RESTRICTED` categories route listings through review

PRD 9.2 gives listings `DRAFT → PENDING_REVIEW → ACTIVE ⇄ PAUSED → ARCHIVED`, and
also says it is *products* that are admin-moderated. If every listing needed
review, `PENDING_REVIEW` would be a queue the platform cannot staff; if none
did, the state would be dead.

So a listing in a `RESTRICTED` category goes to `PENDING_REVIEW` on publish and
waits for an admin; everything else self-publishes. This gives the `RESTRICTED`
flag a job in the phase that introduces it rather than waiting for the Phase 4
age gate.

Publishing is refused without stock: an ACTIVE listing with none is ineligible
for the buy box anyway, so it would be an offer nobody can see.

## Decision 7: `warehouses` arrives here, minimally

`inventory_items` is Phase 2 scope and is keyed by warehouse. PRD 9.2's
onboarding step 5 ("at least one pickup location with pincode") is Phase 1 scope
that Phase 1 did not build — recorded here rather than left as a hole. Phase 2
adds `warehouses` with a name and a pincode and nothing else; zones, rate cards,
slots and serviceability stay in Phase 6.

Inventory is set with **PUT and an absolute figure**, not a delta. A delta over
HTTP has no idempotency: a retry after a timeout silently doubles the
adjustment.

## What this cost, and what it caught

**Two policy traps, both the same shape.** The public-offers policy was written
ungated first; the fix and the reasoning are Decision 2. This is the second time
in two phases that adding a permissive policy to a tenant-owned table widened a
tenant-scoped read. It is now written in `CLAUDE.md` as a rule rather than a
war story.

**A constraint violation is a 400, not a 500.** `translateDbErrors` in
`common/db-errors.ts` maps SQLSTATE 23514/23503/23505 to Bad Request, Bad
Request and Conflict, and re-throws everything else. A CHECK is a real domain
rule — it lives in the migration so no code path can write around it — but a
constraint the *caller* violated is a caller error, and a 500 says the server
broke while doing exactly what it was built to do.

**`Promise.all` over one transaction is a bug.** Four product-page queries were
issued concurrently on a single pooled client; node-postgres queues them with a
deprecation warning today and removes the behaviour in pg 9. They are sequential
now, and the comment says why.

**Tests must not mutate seeded users.** The tenancy suite promoted
`tanvir@acme.test` to MANAGER to prove an invite works. The catalogue suite
asserts a FINANCE user is refused `product:write`. Each passed alone; together,
in parallel against one database, the second failed. Both suites now register
their own invitees.

## Related

- `packages/db/src/schema/{categories,products,listings,warehouses}.ts`
- `packages/db/migrations/0007_catalogue_tables.sql`, `0008_catalogue_rls.sql`
- `packages/shared/src/buy-box.ts`
- `apps/api/src/modules/{catalogue,listings}/`, `src/common/db-errors.ts`
- `apps/api/test/{catalogue,listings}.e2e.test.ts`, `packages/db/src/catalogue-rls.test.ts`
- ADR 0009 (the interceptor), ADR 0011 (why 0006's gate exists)
