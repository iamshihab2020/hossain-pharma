# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**NexMarket** — a universal multi-tenant marketplace (the Daraz/Amazon shape: any verified seller lists anything, buyers compare competing offers on one product page and check out once across many sellers).

The repository directory is still `hossain-pharma` and the git history begins as a pharmacy project. That is historical. **Pharmacy is not a vertical here** and prescription medicine is explicitly out of scope — do not reintroduce health framing into naming, seed data, or copy. Names inside `archive/` are left alone on purpose.

Work is organised into 13 phases. **Phase 0 is complete; Phases 1-12 have not started.** `docs/PRD-marketplace-migration.md` is the spec and `docs/architecture/` holds the decision records. Read `docs/architecture/0003-rls-app-role-and-pooling.md` before touching anything database-related.

## Commands

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres on 5433, Redis on 6380 (NOT the defaults)
pnpm db:push                  # runs migrations; see "db:push is a lie" below
pnpm seed                     # idempotent, safe to re-run
pnpm dev                      # api :4000 · web :3000 · worker
```

The four CI gates, which must all pass:

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

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

Three separate mistakes each reduce RLS to decoration, and **all three fail silently**:

1. **A session-level `SET` instead of transaction-local.** Always
   `set_config('app.tenant_id', value, true)` — the third argument is `is_local`.
   A plain `SET` persists on the pooled connection and the next request, possibly
   another tenant, inherits it.
2. **`ENABLE` without `FORCE ROW LEVEL SECURITY`.** The table owner bypasses every
   policy, and migrations own the tables.
3. **Connecting as a role with `BYPASSRLS`.** It ignores all policies regardless.
   Neon's default `neondb_owner` carries it.

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
- Test coverage thresholds are enforced at 100% on `money.ts`, `tenant-context.ts` and
  `assert-driver.ts`. If one fails, add the missing test rather than lowering the threshold.
