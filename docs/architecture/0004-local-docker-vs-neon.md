# ADR 0004 - Local Docker for development, Neon for deployment

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

## Context

PRD 7.3 names Neon Postgres with branch-per-PR. Success criterion S4 requires a
clean machine to reach a running, seeded application in under 10 minutes.

Those conflict if Neon is required for development: a Neon account, project and
credentials are not a clean-machine step.

## Decision

- **Development and test:** Postgres 16 in Docker Compose, plus Testcontainers
  for test suites
- **Deployment and branch-per-PR:** Neon
- **Both:** plain `node-postgres` (`pg`) over TCP

No application code path differs between them. The driver is identical, so the
constraint in ADR 0005 holds in both places, and nothing branches on environment.

## Why this does not weaken the Neon story

Neon is Postgres. The behaviours this project depends on - row-level security,
`FORCE ROW LEVEL SECURITY`, `set_config` with `is_local`, interactive
transactions - are core Postgres, not managed-service features.

What Neon adds is branch-per-PR, which is a CI concern and is wired in
`.github/workflows/neon-branch.yml`. That workflow is credential-gated and skips
with a log line until `NEON_API_KEY` and `NEON_PROJECT_ID` exist, so CI stays
green before anyone has set Neon up.

## Ports

Host ports are **5433** for Postgres and **6380** for Redis, not the defaults.

Other projects on the development machine already bind 5432 and 6379. Claiming
those would either fail to bind or, worse, point this project's migrations at
another project's database. Container-internal ports are unchanged, and
Testcontainers picks its own random host port per run.

**Check `docker ps` for collisions before adding any service to compose.**

## Consequences

- `docker compose up -d` is a prerequisite for `pnpm dev`, and is in the README
  one-liner
- The test suite needs Docker but no database configuration: verified by running
  all 71 tests with `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `REDIS_URL`
  unset
- `docker/postgres-init/01-app-role.sql` provisions the non-bypassrls
  application role on first boot of an empty volume. The same script is run by
  hand for Neon (see `docs/runbook/neon-setup.md`) and by CI's `spin-up` job,
  because neither sees the compose init directory.
