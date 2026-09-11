# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**NexMarket** — a universal multi-tenant marketplace (the Daraz/Amazon shape: any verified seller lists anything, buyers compare competing offers on one product page and check out once across many sellers).

The repository directory is still `hossain-pharma` and the git history begins as a pharmacy project. That is historical. **Pharmacy is not a vertical here** and prescription medicine is explicitly out of scope — do not reintroduce health framing into naming, seed data, or copy. Names inside `archive/` are left alone on purpose.

Work is organised into 13 phases. **Phases 0-7 are complete; Phases 8-12 have not started.** `docs/PRD-marketplace-migration.md` is the spec, `docs/SYSTEM-DESIGN.md` is the system as built (15 diagrams: the request pipeline, tenancy, the ERD, the lifecycles, the buy box, search), and `docs/architecture/` holds the decision records. `docs/DESIGN-DIRECTION.md` is the front-end design direction - proposed, except for the parts Phase 5 built against it. Read it before adding anything to `apps/web`. Read `docs/architecture/0003-rls-app-role-and-pooling.md` before touching anything database-related, and `0009` before touching guards, the interceptor or anything that resolves a tenant.

## Commands

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres on 5433, Redis on 6380 (NOT the defaults)
pnpm db:push                  # runs migrations; see "db:push is a lie" below
pnpm seed                     # idempotent; 12 orgs, 5 users, 11 categories, 12 products, 26 listings
                              # (8 orgs + the acceptance fixtures, then the demo market in seed/demo.ts)
pnpm dev                      # api :4000 · web :3000 · worker
```

The four CI gates, which must all pass:

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

The search benchmark is **not** in `pnpm test` and has its own script and CI job:

```bash
pnpm --filter @nexmarket/api perf     # 50k documents, one file at a time
```

A benchmark sharing a database with eleven parallel test files times the
contention, not the query. It failed exactly that way before it was split out.

Per-package and single tests:

```bash
pnpm --filter @nexmarket/db test                            # one package
pnpm --filter @nexmarket/db exec vitest run tenant-context  # one file, by path substring
pnpm --filter @nexmarket/db exec vitest run -t "ZERO rows"  # one test; -t is CASE-SENSITIVE
pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=my_migration
```

**Tests require Docker but no database configuration.** Every suite that touches a database starts its own via Testcontainers, including the API suite (whose `globalSetup` sets `DATABASE_URL` before any module reads it). The full suite passes with `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `REDIS_URL` all unset — keep it that way.

**`packages/db` caps itself at four concurrent forks, and that is a memory budget.**
Nine of its files start their own Postgres, one fork per core would boot all nine at once,
and this box has 8 GB with Docker already running. Unbounded, a full `pnpm test` dropped a
file at random — a different one each time, all of them passing standalone — and once
lost `ledger.ts` coverage in `packages/shared` to a partial V8 flush under the same
pressure. The cap costs about five seconds when the package runs alone. **If you see a
test fail in the suite and pass on its own, suspect the box before the code**, and check
what else was holding containers.


## Architecture

```
apps/api        NestJS 11 on Fastify. src/modules · src/common · src/config
apps/web        Next.js 16 App Router, server-first
apps/worker     BullMQ consumers
packages/db     Drizzle schema, migrations, RLS, seed, withTenant
packages/shared Money and framework-free domain primitives
packages/config tsconfig bases, eslint config, tailwind preset
scripts/mongo-etl  legacy MongoDB importer
archive/        legacy SPA, Express monolith, abandoned rewrite. Reference only.
```

Each app and package has its own README describing its internal conventions. Read those before adding to one.

### Tenant isolation — the thing most likely to be broken silently

A tenant is a **seller organisation**. Buyers are not tenants; they belong to the platform and shop across all sellers. Tenant-owned tables carry `tenant_id` and are isolated by Postgres row-level security, not by application `WHERE` clauses.

`users`, `user_identities` and `sessions` are **platform-owned**: no `tenant_id`, no RLS,
and that is a decision rather than an omission (there is a test asserting it). So is the
whole catalogue — `categories`, `products`, `product_variants`, `product_media`,
`product_attributes` — because a catalogue entry shared by competing sellers is the point
of PRD 8.3. The tenant-owned tables are `org_members`, `seller_documents`, `listings`,
`inventory_items`, `warehouses`, `orders`, `order_items`, `shipments`,
`shipment_items`, `order_events`, `order_item_allocations`, `return_pickups`
and the `rls_probe` canary. The Phase 4 commerce tables split three ways and each way is a decision:
`carts`, `cart_items` and `addresses` are platform-owned and user-scoped in the
service (a cart spans sellers by definition); `ledger_accounts`,
`ledger_entries`, `transactions`, `payment_intents` and `payment_events` are
platform-owned and ORG-scoped in the service, because one capture posts against
two sellers and the platform in a single transaction and no tenant GUC can
express that (ADR 0016). `search_documents`,
`recently_viewed` and `saved_searches` are platform-owned too - the first describes
already-public products, the other two are scoped by `user_id` in the service, which is
then the ONLY boundary and is tested as one.

Phase 7's trust tables - `reviews`, `review_media`, `review_votes`, `questions`,
`answers`, `product_ratings` and `seller_ratings` - are **platform-owned with no RLS** for the third application of the same argument: PRD 9.5
puts the rating and its histogram on the PRODUCT PAGE, whose reader has no session and
no tenant. The service is then the whole boundary, and it is a DIFFERENT boundary per
verb - public reads, `ctx.userId` writes, platform-admin moderation - so none of them
shares a helper. ADR 0022.

Phase 6's four geography tables - `delivery_zones`, `serviceability`, `zone_rates` and
`delivery_slots` - are **platform-owned with no RLS**, the same call the catalogue got and
forced by the same constraint: PRD 8.4 puts a serviceability check on the PRODUCT PAGE,
which runs with no tenant, for a visitor who has chosen no seller. A tenant-owned zone
table returns zero rows to exactly that reader. Rates specifically have a second reason -
the buy box ranks competing offers on LANDED price in one pass over public rows, and
per-seller rate cards make that unresolvable for a signed-out buyer. ADR 0021.

Three separate mistakes each reduce RLS to decoration, and **all three fail silently**:

1. **A session-level `SET` instead of transaction-local.** Always
   `set_config('app.tenant_id', value, true)` — the third argument is `is_local`.
   A plain `SET` persists on the pooled connection and the next request, possibly
   another tenant, inherits it.
2. **`ENABLE` without `FORCE ROW LEVEL SECURITY`.** The table owner bypasses every
   policy, and migrations own the tables.
3. **Connecting as a role with `BYPASSRLS`.** It ignores all policies regardless.
   Neon's default `neondb_owner` carries it.

`TenantContext` carries **three** values - `tenantId`, `userId` and `isAdmin` - and
`withTenant` sets a GUC for each. `app.user_id` exists so `org_members` can answer
"which organisations does this caller belong to?" *before* any tenant is known: the
lookup that decides `tenant_id` cannot itself require `tenant_id`. See ADR 0011.

Consequences for anything you write:

- **Never import `db` or `pool` from `@nexmarket/db`.** Use `withTenant`. A lint rule
  enforces this. Two sanctioned exceptions exist, both liveness-only and both
  commented at the import: the boot probe in `apps/api/src/main.ts` and `HealthService`.
- **New tenant-owned tables need `ENABLE` + `FORCE` + policies in a hand-written
  migration.** Copy the shape from `packages/db/migrations/0001_rls_probe_policies.sql`,
  including the `NULLIF(current_setting(...), '')::uuid` wrapper — without it a null
  tenant raises `invalid input syntax for type uuid` instead of returning zero rows.
- **Missing tenant context must return zero rows, never all rows.**
- `rls_probe` is a deliberate canary table with no business meaning. Keep it.
- **`org_members` carries a second, SELECT-only `own_membership` policy**, gated on no
  tenant being selected (migration 0006). Permissive policies are ORed, so an ungated
  version made every tenant-scoped read return the caller's rows from other tenants
  as well. It has no `WITH CHECK`, deliberately - that is what stops a user granting
  themselves a membership.
- **A second permissive policy on a tenant-owned table widens every tenant-scoped read.**
  Postgres ORs them. This has now bitten three times - `own_membership` on `org_members`
  (migration 0006), `public_active_offers` on `listings` (0008) and `own_orders` on
  `orders` (0012) - and every fix is the same: gate the extra policy on
  `NULLIF(current_setting('app.tenant_id', true), '') IS NULL`, so it applies only while
  no tenant is selected. Assume any new policy has this bug until a test says otherwise.
- **The seed writes `org_members` through `withTenant`.** The seed connects as
  `nexmarket_app` (NOBYPASSRLS), so a plain `db.insert(orgMembers)` inserts **zero rows
  and throws nothing** - the `WITH CHECK` silently rejects every row whose tenant it
  cannot attribute, and the seed reports success against an empty table.

### The request pipeline

`AuthGuard` and `TenantInterceptor` are registered **globally** in `app.module.ts`, so a
new controller with no decorators is closed and tenant-scoped. Opting out is `@Public()`.

- **Services take their transaction from `getRequestContext().tx`**, never a `db` handle.
  The GUCs are transaction-local, so any other connection carries no tenant context.
  `getRequestContext()` throws outside a request rather than falling back.
- **Guards run before interceptors**, always. That is why the capability check lives
  *inside* `TenantInterceptor` and not in an `APP_GUARD` - a guard cannot read the roles
  the interceptor resolves. `AdminGuard` can be a guard, because `platform_role` is a
  token claim `AuthGuard` already attached. ADR 0009.
- The tenant arrives as an `x-tenant-id` header, validated as a UUID before it reaches
  `set_config` - otherwise the policy's `NULLIF(...)::uuid` cast raises inside the query
  and a caller typo becomes a 500.
- Capabilities are declared with `@RequireCapability('member:write')`. **Never read a
  role name.** ADR 0013.
- **Five places move `app.tenant_id` outside `withTenant`**, all in
  `common/tenant-scope.ts`: founding an organisation, reindexing search (a cross-tenant
  aggregate), placing an order at checkout (a buyer writing to four tenant-owned
  tables across several sellers), CANCELLING one (the same buyer, one seller -
  ADR 0019), and BOOKING A RETURN PICKUP (Phase 6, same shape as cancellation).
  All are transaction-local and restore in a `finally`.
  Before adding a sixth, ask whether the work is genuinely not tenant-scoped or is
  tenant-scoped work being done from the wrong place - it has been the second more often,
  and Phase 4 rejected one on exactly those grounds: the ledger looked like it needed
  one and turned out to be platform-owned instead (ADR 0016). Two of the five are now
  "a buyer acting on their own order"; a third of that shape should become a named
  helper rather than a sixth bare call.
- **A write that changes what a buyer would FIND must reindex.** `SearchIndexService` is
  the only writer of `search_documents`; the hooks live in the listings, catalogue-admin,
  org-governance, checkout and fulfilment services. Cancelling lines puts stock back and
  must reindex; DISPATCH deliberately must not, because `on_hand` and `reserved` fall
  together and `available` is unchanged. Suspending a seller is the least obvious one and
  **placing an order** is the second - buying the last unit flips `in_stock`. Checkout must
  also call `ListingsService.recomputeAvailableStock` rather than writing
  `listings.available_stock` itself: that column has one documented writer, and a
  denormalised column with two writers drifts under concurrency. The drift
  test in `search.e2e` compares the table to its source view and is what makes that list
  verifiable rather than a claim.

`DATABASE_URL` connects as `nexmarket_app` (NOBYPASSRLS). `DATABASE_MIGRATION_URL`
connects as the owner, which has the DDL rights the app role deliberately lacks.

### `pnpm db:push` runs migrations, not `drizzle-kit push`

`push` diffs the schema and cannot express `CREATE POLICY`, `FORCE ROW LEVEL SECURITY`,
or grants. The name is kept because it is documented in the PRD and README. Do not
"fix" it into a real push.

**Drizzle silently ignores any migration not listed in `migrations/meta/_journal.json`.**
A hand-dropped `.sql` file sits in the repo looking applied while never running. Always
create hand-written migrations with `drizzle-kit generate --custom`, which writes the
file, journal entry and snapshot together.

**But `--custom` writes the PREVIOUS snapshot, not the current schema**, and that
freezes the diff base until someone notices. 0013 and 0014 were both `--custom`, so
the chain sat at Phase 4 for the whole of Phase 5; the first ordinary
`drizzle-kit generate` afterwards (0015) re-emitted `CREATE TABLE shipments`,
`shipment_items`, `order_events`, the `order_status` enum values and
`order_items.cancelled_quantity` — a migration that fails on the first statement
against any database that already has them. **After a run of `--custom` migrations,
the next generated one carries a correct snapshot and an over-broad `.sql`: keep the
snapshot, trim the SQL to the real delta.** That repairs the chain. `drizzle-kit check`
passes either way and will not catch this.

Changing an already-applied migration's contents changes its hash and requires
recreating the database.

### The ledger and payments (Phase 4)

- **`ledger_entries` is append-only, and the `REVOKE` is what makes it so.** Migration
  0001 ran `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`, so every
  new table already carries all four. A narrower `GRANT` is purely additive: it reads
  like a restriction and removes nothing. This was verified against the live database
  after the first version of migration 0012 did exactly that.
- **`ON CONFLICT DO UPDATE` needs the UPDATE privilege**, which collides with the revoke.
  Use `DO NOTHING` then `SELECT`; it is still race-safe.
- **The webhook is the only writer of `payment_intents.status`.** Checkout creates an
  intent and never advances it. The port types `initialStatus` so no adapter can return a
  settled status.
- **Idempotency is a unique constraint, never a prior lookup.** Two concurrent deliveries
  of one gateway retry would both pass a `SELECT`; insert first and read the row count.
- **A conditional UPDATE must repeat its predicate OUTSIDE the subquery.** Postgres
  evaluates a subquery against the pre-lock snapshot and re-checks only the outer `WHERE`
  after the lock, so the first version of the stock reservation let two checkouts take the
  last unit. `FOR UPDATE` inside plus the predicate outside; both halves are load-bearing.

### Logistics (Phase 6)

- **`inventory_items.reserved` is a TOTAL, not a claim.** It says how many units are
  spoken for, never by whom. `order_item_allocations` is what records which warehouse is
  holding which order line's units, and it exists because without it dispatching order B
  happily consumed the units order A had reserved - identical rows, no way to tell them
  apart, and the robbed order simply failed to ship later.
- **Reservation spreads ACROSS warehouses.** Phase 4 required one inventory row to hold
  the whole quantity, so a seller with three units in Dhaka and three in Chattogram could
  not sell four - while `listings.available_stock`, which SUMS across warehouses, went on
  advertising six. Phase 6 found it. The loop is the Phase 4 conditional UPDATE per row,
  and the amount taken is computed in a CTE rather than in `RETURNING`, because RETURNING
  evaluates against the NEW row and `LEAST(need, on_hand - reserved)` there reads the
  already-incremented counter and yields zero.
- **The shipping QUOTE port is synchronous and database-free, and that is load-bearing.**
  The caller resolves the postcode to a zone once and hands the rate card in, so the
  adapter stays a pure function and the checkout path keeps one lookup rather than one per
  seller group. `ShippingProvider` (booking and tracking) is a SEPARATE port for the
  opposite reason: it talks to somebody else's network, after the money has moved.
- **Reservation and DISPATCH both spread; teaching one and not the other is worse than
  neither.** Phase 6 taught `reserve()` to take units from several warehouses and left
  `dispatchStock` demanding a single row, so a line reserved as three-plus-one matched
  nothing and the console answered "that is more than this order has left" about an order
  with four units left. The order could be taken and then could not move. `releaseStock`
  draws from `order_item_allocations` in warehouse priority order for exactly this reason,
  and only falls back to the unscoped statement for orders placed before migration 0019,
  which recorded no allocations at all.
- **Carrier events are idempotent by COMPARISON, not by a unique index.** Shipment states
  are totally ordered, and an event not ahead of where the parcel already is does nothing.
  Money cannot work this way - two captures of the same amount are not one capture - which
  is why the payment webhook uses a constraint instead.
- **A carrier that NAMES the event needs no schedule.** The mock decodes a parcel's history
  from the tracking number it minted, so it has nothing to say about a number a seller
  typed - which is every manually dispatched parcel. Refusing those made `TrackingService`
  answer "no events for that tracking number" about a parcel it finds by that very number
  one line later. The time-compressed schedule is the FALLBACK for a carrier that reports
  no type; a reported state is a fact and stands on its own.
- **A COD order may be ACCEPTED while still PENDING_PAYMENT.** Shipping before the money
  arrives is what cash on delivery means. `order-state.ts` allows the edge and knows
  nothing about payment methods; `FulfilmentService.accept` is what refuses a card order
  that was never paid for. **The console has to make the same distinction**, which is why
  `OrderDetail` carries `paymentMethod` at all: gating the accept button on `PAID` - which
  is what it did until the S3 journey pressed it - meant a cash order could be placed and
  then never accepted, never shipped, and so never collected, with every API test green.

### Trust (Phase 7)

- **A review hangs off an ORDER LINE, not off a product with a `verified` flag.** That is
  what makes "only delivered purchases can review" three mechanisms rather than one
  forgettable check: the order is yours (a predicate), it is DELIVERED (a predicate read
  at write time, not trusted from the page), and once (`reviews_order_item_key`, a unique
  constraint rather than a prior SELECT). **The product is DERIVED from the line**, never
  taken from the body - a caller naming both could review one thing on the strength of
  having bought another, which is exactly what the badge would then be worth.
- **The histogram is the stored rating and nothing derived is stored beside it.** Five
  integers give the count, the average and every bar; an average column would be a second
  source of truth for one fact, and ADR 0010 exists because this has bitten twice.
  `ReviewAggregateService` is the only writer, it takes the CALLER's transaction so the
  aggregate commits with the review, and it recomputes from source rather than
  incrementing - an edit is a decrement and an increment that must both land.
  `ratingDrift` in `packages/db` is the comparison, and it lives beside the statements it
  checks because a comparison written inside a test agrees with the bug.
- **FLAGGED is still visible; only REMOVED disappears.** A report is an accusation, not a
  verdict, and on a marketplace the first complainer is usually the seller the review is
  about. REMOVED is gone from FIVE surfaces - the list, the histogram, the seller score,
  the buy box and the search index - and the one that gets missed is the histogram,
  because every read filters the status on its own and only the aggregate refresh fixes
  the rest.
- **Moderation is a status; the author's own delete is a DELETE.** Two verbs, two
  mechanisms: a person withdrawing their own words leaves nothing behind, a moderator
  taking somebody else's down has to stay auditable and reversible.
- **`sellerRating` in the buy box is no longer null.** PRD 8.3 wrote that ranking key in
  during Phase 2 and `catalogue.service.ts` passed `null` for every seller until Phase 7.
  It arrives as a LEFT JOIN on `seller_ratings`, averaged by the SHARED function rather
  than in SQL, and NULL still means "unrated" - which sorts behind a rated seller rather
  than below a one-star.
- **Denormalise where the READ cannot afford the join, not everywhere the number
  appears.** A rating gets `product_ratings` because the buy box ranks on it in a query
  over the whole catalogue; a helpful count gets no column at all, because the only page
  that shows it has already fetched the twenty reviews it belongs to. `review_votes` is
  keyed on (review, user), so voting is idempotent by construction and un-voting is a
  DELETE - there is no counter to drift.
- **Asking a question needs NO purchase, which is why Q&A is its own table and its own
  service.** A review is a verdict on something you received; a question is what you ask
  before buying, and gating it on an order would leave it askable only by the people who
  no longer need to ask. `answers.seller_org_id` is nullable and verified against
  `org_members` at write time - on a marketplace "the seller replied" is ambiguous until
  you say WHICH, and a header that promoted an answer without a membership check would
  make the badge worth nothing.
- **Auto-flagging flags; it can never hide or refuse.** A twenty-word list is wrong often
  enough that letting it block would be a censorship bug with a scheduler. The review is
  written, visible and counted, with its reasons in `flag_reasons` - an ARRAY, because the
  rules are independent and the combination is the signal. RESTORE clears the array as
  well as the status, or a cleared review looks like one nobody has reached yet.
- **A review photo's serve route is where moderation binds.** `GET /reviews/media/:id`
  refuses a photo whose review is REMOVED. Nothing lists photo ids, so this is the one
  surface a takedown could miss silently.
- **A Server Action refreshes the route it was called from**, so client state set after
  one can paint into a component that has already unmounted. The review form's "thank
  you" was unreachable for exactly this reason and the E2E journey is what noticed; it
  redirects to `/reviews?posted=1` instead, the same way checkout carries its
  confirmation in `/orders?placed=`.

### Money

`type Money = { amount: number; currency: string }` where `amount` is **integer minor
units**. No floats in any pricing, tax, discount, shipping or ledger path. Use the
helpers in `@nexmarket/shared`. `allocate()` splits one amount across parts without
losing a unit - and note that Phase 6's warehouse allocator is `allocateStock()`, named
apart deliberately: both are re-exported from the package index, so a shared name does not
conflict, it SHADOWS, and the first caller wanting money-splitting silently gets warehouse
arithmetic. Phase 4 predicted it would earn its place at a promotion (Phase 9) or a
partial refund (Phase 8); **a partial shipment got there first** (ADR 0020). A parcel
carries units, not a fraction, and recomputing its share as a fresh percentage overpays
at every rounding boundary without failing anything.

The legacy server did `parseInt(price * 100)`, which truncates. That bug is what this
module exists to make unrepresentable.

### Module system

`packages/db` and `packages/shared` are ESM, which forced `apps/api` to be ESM too:
TypeScript raises TS1479 on a static CommonJS-to-ESM import. ESM importing CJS always
works, so the API moved. **All relative imports carry `.js` extensions.** Decorators are
unaffected.

Each package carries two tsconfigs: `tsconfig.json` (includes tests, `noEmit`, read by
type-check and typescript-eslint's project service) and `tsconfig.build.json` (excludes
tests, `composite`, emits). A single config excluding tests makes eslint fail with
"not found by the project service" on every test file.

## Pinned dependencies

These are pinned for stated reasons, not by accident. Read `docs/architecture/0001` and
`0006` before bumping any of them.

| Package | Pin | Reason |
|---|---|---|
| `typescript` | 5.9.3 | `pnpm add typescript` resolves 7.x, which `typescript-eslint` (`<6.1.0`) does not support. Two PRD acceptance criteria depend on that linter. |
| `tailwindcss` | 3.4.x | v4 is CSS-first and incompatible with the salvaged v3 config and primitives |
| `react-day-picker` | 9.11.x | v10 changed the `ClassNames` API the salvaged `calendar.tsx` targets |

`.npmrc` sets `strict-peer-dependencies=false`, so a peer mismatch installs silently and
fails later. **Check resolved versions before writing config against them.**

New dependencies with install scripts must be listed in `pnpm-workspace.yaml` under
`allowBuilds` or pnpm 11 blocks them.

## Ports

Host ports are **5433** (Postgres) and **6380** (Redis), not the defaults, because other
projects on this machine bind 5432/6379. Container-internal ports are standard.
**Run `docker ps` before adding any service to compose.**

## Conventions

- Frontend `apps/web/components/ui/` is vendored shadcn/ui, regenerable by its CLI. Lint
  rules are relaxed there but type-checking still applies. Anything you author goes
  outside that directory.
- `exactOptionalPropertyTypes` is off for the frontend only; backend packages keep it on.
- Next 16 has breaking changes from 15 and ships local docs at
  `apps/web/node_modules/next/dist/docs/`. Read those rather than relying on Next 15 habits.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are generated and re-added by `next dev`.
  They are committed deliberately; deleting them only recreates an uncommitted change.
- **`apps/web` tests run in the NODE environment** - no jsdom, no browser runner, no
  snapshots. Server components cannot be meaningfully driven by a DOM testing library, so
  what gets tested is the pure view helpers in `lib/` and the server actions' input
  parsing; behaviour lives in the API's e2e suite. Settled in Phase 5; the reasoning is
  in `apps/web/lib/order-timeline.test.ts`.
- Test coverage thresholds are enforced at 100% on `money.ts`, `capabilities.ts`,
  `buy-box.ts`, `ledger.ts`, `pricing.ts`, `order-state.ts`, `fulfilment.ts`,
  `logistics.ts`, `allocation.ts`, `reviews.ts`, `tenant-context.ts` and
  `assert-driver.ts`. If one
  fails, add the missing test rather than lowering the threshold. Twice now the honest
  fix has been to DELETE an unreachable branch rather than test it - a `?? 0` on a map
  key that cannot be missing is a safety net over solid ground.
- **Never mutate seeded users, organisations OR PRODUCTS in a test.** Granting
  `tanvir@acme.test` a role in one file changed what he could do in another, which passed
  alone and failed in the suite. Register your own fixtures. Products bit later and the
  same way: `catalogue.e2e` asserts an empty buy box on the restricted product while
  `listings.e2e` published a listing against it and left it live, so which one won was
  whichever file got there first. The seed now carries TWO restricted products with
  opposite jobs - `harbour-single-malt` is never listed, `estuary-dry-gin` is what the
  review path lists against - and both say so in their description.
- **Tests are CO-LOCATED with their source**, everywhere except `apps/api/test/`,
  which holds the ones that boot the Nest app (`Test.createTestingModule`) and are
  named `*.e2e.test.ts`. The line is the application, not the database:
  `packages/db/src/catalogue-rls.test.ts` starts a Postgres and is still beside its
  schema. There is no central `tests/` tree and adding one would break per-package
  turbo caching and `packages/shared`'s per-file coverage thresholds.
  `apps/api/README.md` has the full reasoning.
- **Namespace test emails per file** (`onboarding-`, `admin-`, ...). Vitest runs test
  files in parallel against the one database the API suite starts, and `users.email` is
  globally unique, so a bare `dupe@example.test` in two files is a 409 for whichever
  loses the race - green in a single-file run, red in the suite.
- **A raw `tx.execute` skips Drizzle's column mapping**, so a timestamptz can come back
  as a string rather than a Date. Normalise it; the assumption survives every small test
  and fails on the first result set large enough to page.
- **Do not put a correlated subquery in a Drizzle `sql` template in the SELECT list.**
  Drizzle renders the column references there *without table qualification*, so
  `WHERE ${a.tenantId} = ${b.id}` becomes `WHERE "tenant_id" = "id"` - the table
  compared to itself, always false, no error. It cost an afternoon once; ADR 0010.
