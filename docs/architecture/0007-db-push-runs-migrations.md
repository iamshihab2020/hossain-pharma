# ADR 0007 - `pnpm db:push` runs migrations

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

## Context

PRD 11 and success criterion S4 document the one-liner:

```bash
pnpm i && pnpm db:push && pnpm seed && pnpm dev
```

That name implies `drizzle-kit push`, which diffs the TypeScript schema against
the live database and applies the difference.

`push` cannot express any of the following:

- `CREATE POLICY`
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- `GRANT` / `ALTER DEFAULT PRIVILEGES`

All three are load-bearing (ADR 0003). A schema-diff tool has no notion of them,
so a `push`-based workflow would create the tables and silently omit every
isolation guarantee.

## Decision

Keep the public name `pnpm db:push`, implemented as `drizzle-kit migrate`:

```json
"db:push": "pnpm --filter @nexmarket/db run migrate"
```

RLS, grants and default privileges live in hand-written migrations alongside the
generated ones.

The name is kept because it appears in the README, in the PRD, and in S4. The
alias is documented here so nobody later "fixes" it into a real `push` and
quietly removes tenant isolation.

## Hand-written migrations

Use `drizzle-kit generate --custom --name=<name>`.

Drizzle's migrator reads `migrations/meta/_journal.json` and **silently ignores**
any `.sql` file not listed there. A hand-dropped file would sit in the repository
looking applied while never having run. For an RLS migration that means the
policies do not exist and every test that does not check `pg_policy` still
passes.

`--custom` creates the file, the journal entry and the snapshot together.

## Consequences

- Migrations are ordered and versioned; there is no "sync the schema" shortcut
- Changing an already-applied migration's contents changes its hash. When the
  project was renamed and the role name inside migration `0001` changed, the
  database had to be recreated. That was correct, not incidental.
- CI asserts the outcome rather than the mechanism: the `spin-up` job checks
  that `rls_probe` has `relrowsecurity` **and** `relforcerowsecurity` true after
  `pnpm db:push`.
