# ADR 0001 - Monorepo layout and stack

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

## Context

NexMarket spans a Next.js frontend, a NestJS API, a background worker, and a
shared database layer, and PRD 1 records that the codebase may later be sold.
Those two facts pull in the same direction: types must cross the tier boundary
without a publish step, and a buyer should be able to clone one repository and
run everything.

## Decision

pnpm workspaces with Turborepo. Three apps under `apps/`, four packages under
`packages/`, one script package under `scripts/`.

```
apps/api      NestJS 11 on Fastify, ESM
apps/web      Next.js 16 App Router, server-first
apps/worker   BullMQ consumers
packages/db       Drizzle schema, migrations, RLS, seed, withTenant
packages/shared   framework-free domain primitives (Money today)
packages/config   tsconfig bases, eslint config, tailwind preset
scripts/mongo-etl legacy MongoDB importer
```

`packages/db` is the only module that opens a database connection. Everything
else goes through `withTenant`, enforced by lint (see ADR 0003).

## Resolved versions

Read from the lockfile on 2026-08-23. Recorded because several were not what the
PRD assumed.

| Package | Version | Note |
|---|---|---|
| node | 24.15.0 | |
| pnpm | 11.0.9 | |
| turbo | 2.10.11 | |
| typescript | 5.9.3 | **pinned**, see below |
| @nestjs/core | 11.2.1 | matches PRD |
| @nestjs/platform-fastify | 11.2.1 | |
| next | 16.3.2 | PRD said 15; 16 satisfies the floor |
| react | 19.2.8 | |
| drizzle-orm | 0.45.2 | |
| drizzle-kit | 0.31.10 | |
| pg | 8.23.0 | node-postgres, see ADR 0004 |
| bullmq | 6.2.0 | |
| ioredis | 6.0.0 | dropped its constructable default export |
| tailwindcss | 3.4.17 | **pinned**, see ADR 0006 |
| react-day-picker | 9.11.2 | **pinned**, see ADR 0006 |
| vitest | 4.1.11 | transforms with oxc, not esbuild |
| testcontainers | 12.1.0 | |
| zod | 4.4.3 | |
| eslint | 10.9.0 | |
| typescript-eslint | 8.67.0 | |
| mongodb | 7.5.0 | ETL only |

### TypeScript is pinned to 5.9.3

`pnpm add typescript` resolves **7.0.2**, which is the genuine stable latest.
Decorators compile fine on it, so NestJS is not the obstacle.

`typescript-eslint` declares `typescript: ">=4.8.4 <6.1.0"` and does not support
TypeScript 7. Because `.npmrc` sets `strict-peer-dependencies=false`, that
mismatch installs silently and fails at lint time rather than install time.

Two acceptance criteria depend on that linter specifically: PRD 6.4 criterion 2
(the `no-restricted-imports` ban on the raw `db` handle) and S7 (`no-explicit-any`).
Dropping the linter to gain a TypeScript major costs more than it buys.

**Re-verify by:** `npm view typescript-eslint peerDependencies`. When the range
admits 7.x, the pin can be lifted.

## Consequences

- One `pnpm install` at the root; Turborepo caches per-task
- `packages/db` and `packages/shared` are ESM, which forced `apps/api` to be ESM
  too (ADR 0005)
- Each package carries `tsconfig.json` (includes tests, `noEmit`, read by
  type-check and typescript-eslint's project service) and `tsconfig.build.json`
  (excludes tests, `composite`, emits). A single config excluding tests made
  eslint fail with "not found by the project service" on every test file.
- The TypeScript pin is a known-stale dependency that must be revisited
