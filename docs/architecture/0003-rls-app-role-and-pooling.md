# ADR 0003 - RLS: the app role, FORCE, and the pooling hazard

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

**This is the most important decision in Phase 0.** Three separate mistakes each
independently reduce tenant isolation to decoration, and all three are silent.

## Context

A tenant is a seller organisation (PRD 6.1). Tenant-owned tables carry
`tenant_id` and are isolated by Postgres row-level security rather than by
application `WHERE` clauses, so that a forgotten filter is a non-event instead of
a data breach.

RLS only works if all three of the following hold. Each fails silently.

## Decision

### 1. Tenant context is transaction-local, never session-level

```ts
await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true)`);
```

The third argument is `is_local`. It makes the call exactly equivalent to
`SET LOCAL`: scoped to this transaction, discarded at COMMIT or ROLLBACK.

A plain `SET` persists on the **physical connection** after the request ends.
The pooler hands that connection to the next request, possibly for a different
tenant, which inherits the previous tenant's context and reads their rows.

This never appears in single-user testing. It appears under concurrent load, as
a cross-tenant read.

**Never replace `set_config(..., true)` with a plain `SET`, and never set tenant
context outside a transaction.**

### 2. `FORCE ROW LEVEL SECURITY`, not just `ENABLE`

`ENABLE ROW LEVEL SECURITY` does not apply to the table **owner**. Migrations
create the tables, so the migration role owns them, and every policy would be
skipped for that role. `FORCE` closes it.

### 3. The application connects as a role that cannot bypass RLS

`hossain_app`, now `nexmarket_app`, is created `NOBYPASSRLS` and is not a
superuser. A superuser, and any role carrying `BYPASSRLS`, ignores every policy
regardless of `FORCE`.

> This is not hypothetical. A sibling project in this account has **112
> policy-bearing tables whose RLS is inert** because its connection role carries
> `rolbypassrls`. Neon hands you exactly such a role (`neondb_owner`) by
> default.

`DATABASE_URL` uses the application role. `DATABASE_MIGRATION_URL` uses the
owner, which needs DDL rights the application role deliberately lacks.

### Missing context fails closed

Policies compare against `NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
`withTenant` writes an empty string for a null tenant, and `''::uuid` would raise
`invalid input syntax for type uuid`. `NULLIF` turns it into NULL, and
`tenant_id = NULL` is NULL rather than TRUE, so **no rows** come back.

Missing context must yield zero rows, never all rows.

## Acceptance criteria and where each is discharged

PRD 6.4 lists four. Three land in Phase 0.

| # | Criterion | Status |
|---|---|---|
| 1 | An interceptor wraps every request touching tenant data | **Phase 1** - there is no tenant-scoped route yet for it to wrap, and an interceptor with nothing to intercept cannot be tested honestly |
| 2 | A lint rule forbids importing the raw `db` handle outside `packages/db` | done - verified by running eslint against a file importing `db` and `pool`; both refused |
| 3 | A concurrency test fires interleaved requests from two tenants against a shared pool and asserts zero cross-reads | done - 40 requests alternating tenants over a 5-connection pool |
| 4 | Omitting tenant context returns zero rows, never all rows | done |

Two sanctioned exceptions to criterion 2 exist, both liveness-related, both
commented at the import: the boot probe in `apps/api/src/main.ts` and
`HealthService`. Neither reads tenant data.

## Verification

`packages/db/src/tenant-context.test.ts`, 11 tests against a real Postgres 16 via
Testcontainers, 100 percent coverage. The first test asserts the connecting role
has `rolsuper=false` and `rolbypassrls=false`, with a comment saying every other
test in the file is meaningless if it does not. CI re-asserts the same thing
against its own database in the `spin-up` job.

The pooling hazard is reproduced directly: a `max:1` pool guarantees the
follow-up statement reuses the exact connection the transaction ran on, and the
test asserts the setting is gone.

## Consequences

- Every tenant-owned table added from Phase 1 repeats
  `ENABLE` / `FORCE` / `CREATE POLICY` in its migration. Phase 1 factors that
  into a helper once there are enough tables to justify one.
- Seeding tenant-owned data must go through `withTenant` or the owner
  connection. Phase 0's seed connects as the app role and touches no
  RLS-enabled table; the first tenant-owned seed will insert zero rows if this
  is forgotten.
