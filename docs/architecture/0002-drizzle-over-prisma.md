# ADR 0002 - Drizzle over Prisma

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

## Context

Tenant isolation is enforced by Postgres row-level security, and the policies
read `current_setting('app.tenant_id', true)`. That value has to be set
per-request, inside a transaction, on the same physical connection the query
runs on (ADR 0003 explains why).

The ORM therefore has to give direct, reliable control over transaction
boundaries and over which connection a statement lands on.

## Decision

Drizzle ORM with `drizzle-orm/node-postgres`.

## Rationale

**Confidence: stated, not benchmarked.** This is a design rationale, not a
measurement. Recorded so a future reader knows which parts were tested.

- **RLS needs per-request session variables inside a transaction.** Drizzle's
  `db.transaction(async (tx) => ...)` hands back a transaction handle bound to
  one connection, and `tx.execute(sql\`SELECT set_config(...)\`)` runs on it.
  Prisma's transaction API is more indirect under connection pooling, which is
  precisely where getting this wrong is invisible.
- **SQL-first reads well to a code buyer** (PRD 1). Drizzle schema files look
  like the tables they describe.
- **No separate schema language or codegen step.** The schema is TypeScript, so
  `packages/db` exports table objects that the rest of the workspace types
  against directly.

## What this costs

`drizzle-kit push` cannot express `CREATE POLICY`, `FORCE ROW LEVEL SECURITY`,
or role grants, so RLS lives in hand-written migrations. See ADR 0007.

Migrations must be generated with `drizzle-kit generate --custom` when
hand-written: the migrator reads `migrations/meta/_journal.json` and **silently
ignores** any `.sql` file not listed there. A hand-dropped migration would sit
in the repository looking applied while never running - which for an RLS
migration means no isolation at all.

## Alternatives

- **Prisma** - the obvious default, rejected for the transaction-control reason above
- **Raw pg with query builders** - full control, but no typed schema, and the
  type safety across the tier boundary is a stated goal
- **Kysely** - comparable control; Drizzle chosen for the schema-as-TypeScript
  ergonomics
