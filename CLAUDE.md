# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**NexMarket** — a universal multi-tenant marketplace (the Daraz/Amazon shape: any verified seller lists anything, buyers compare competing offers on one product page and check out once across many sellers).

The repository directory is still `hossain-pharma` and the git history begins as a pharmacy project. That is historical. **Pharmacy is not a vertical here** and prescription medicine is explicitly out of scope — do not reintroduce health framing into naming, seed data, or copy. Names inside `archive/` are left alone on purpose.

Work is organised into 13 phases. **Phases 0-3 are complete; Phases 4-12 have not started.** `docs/PRD-marketplace-migration.md` is the spec and `docs/architecture/` holds the decision records. Read `docs/architecture/0003-rls-app-role-and-pooling.md` before touching anything database-related, and `0009` before touching guards, the interceptor or anything that resolves a tenant.

## Commands

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres on 5433, Redis on 6380 (NOT the defaults)
pnpm db:push                  # runs migrations; see "db:push is a lie" below
pnpm seed                     # idempotent (8 orgs, 5 users, 11 categories, 3 products, 4 listings)
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
`inventory_items`, `warehouses` and the `rls_probe` canary. `search_documents`,
`recently_viewed` and `saved_searches` are platform-owned too - the first describes
already-public products, the other two are scoped by `user_id` in the service, which is
then the ONLY boundary and is tested as one.

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
  Postgres ORs them. This has now bitten twice - `own_membership` on `org_members`
  (migration 0006) and `public_active_offers` on `listings` (0008) - and both fixes are
  the same: gate the extra policy on
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
- **Two places move `app.tenant_id` outside `withTenant`**, both in
  `common/tenant-scope.ts`: founding an organisation, and reindexing search (a
  cross-tenant aggregate). Both are transaction-local and restore in a `finally`. Before
  adding a third, ask whether the work is genuinely not tenant-scoped or is tenant-scoped
  work being done from the wrong place - it has been the second more often.
- **A write that changes what a buyer would FIND must reindex.** `SearchIndexService` is
  the only writer of `search_documents`; the hooks live in the listings, catalogue-admin
  and org-governance services. Suspending a seller is the least obvious one. The drift
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

Changing an already-applied migration's contents changes its hash and requires
recreating the database.

### Money

`type Money = { amount: number; currency: string }` where `amount` is **integer minor
units**. No floats in any pricing, tax, discount, shipping or ledger path. Use the
helpers in `@nexmarket/shared` — `allocate()` in particular splits one payment across
sellers without losing a unit, which the Phase 4 ledger depends on.

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
- Test coverage thresholds are enforced at 100% on `money.ts`, `capabilities.ts`,
  `buy-box.ts`, `tenant-context.ts` and `assert-driver.ts`. If one fails, add the missing test rather
  than lowering the threshold.
- **Never mutate seeded users or organisations in a test.** Granting
  `tanvir@acme.test` a role in one file changed what he could do in another, which passed
  alone and failed in the suite. Register your own fixtures.
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
