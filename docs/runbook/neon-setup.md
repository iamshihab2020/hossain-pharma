# Neon setup

Nothing in this repository requires Neon. Local development runs entirely on
Docker Postgres (`docker compose up -d`), and CI uses a service container plus
Testcontainers. Neon is the **deployed** target and the branch-per-PR mechanism.

Both use the same `node-postgres` driver over TCP, so no application code path
differs between them.

## The one thing that must not be got wrong

> **Neon's default owner role, `neondb_owner`, carries `rolbypassrls`.**
>
> A role with `BYPASSRLS` silently ignores every row-level security policy. If
> `DATABASE_URL` points at that role, every policy in `packages/db/migrations`
> becomes decoration: tenant isolation tests still pass, and the database
> enforces nothing.
>
> This is not hypothetical. A sibling project in this account has 112
> policy-bearing tables whose RLS is inert for exactly this reason.

`DATABASE_URL` must use `nexmarket_app`. `DATABASE_MIGRATION_URL` uses the owner,
because migrations need DDL rights the application role deliberately lacks.

## Checklist

Requires a Neon account. None of this blocks Phase 0.

1. **Create a Neon project.** Note the project ID.

2. **Create the application role.** In the Neon SQL editor, run the contents of
   `docker/postgres-init/01-app-role.sql`, changing the password. It creates
   `nexmarket_app` with `NOBYPASSRLS` and grants it schema and table access.

3. **Verify the role cannot bypass RLS.** Connected via the *application*
   connection string, not the owner one:

   ```sql
   SELECT current_user, rolsuper, rolbypassrls
   FROM pg_roles WHERE rolname = current_user;
   ```

   Must return `nexmarket_app | f | f`. If either column is `t`, stop and fix it
   before anything else - nothing downstream is trustworthy until this passes.

4. **Set the repository secret and variable** so `.github/workflows/neon-branch.yml`
   activates:
   - secret `NEON_API_KEY`
   - variable `NEON_PROJECT_ID`

   Until both exist the workflow skips with a log line and CI stays green.

5. **Set the deploy environment variables:**
   - `DATABASE_URL` - the `nexmarket_app` connection string
   - `DATABASE_MIGRATION_URL` - the `neondb_owner` connection string

6. **Run the migrations** against the Neon branch: `pnpm db:push`.

## Driver note

Do not switch to `@neondatabase/serverless` over HTTP. That driver cannot hold
interactive transactions, and both RLS tenant context (`set_config(..., true)`)
and the double-entry ledger require them. The startup assertion in
`packages/db/src/assert-driver.ts` fails the boot if the configured driver
cannot, so a wrong choice surfaces immediately rather than as silent
cross-tenant reads. See PRD 6.5.

If Neon's WebSocket `Pool` is ever preferred over plain TCP, it satisfies the
same constraint - the assertion will confirm it.
