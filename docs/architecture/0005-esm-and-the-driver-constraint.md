# ADR 0005 - ESM everywhere, and the interactive-transaction constraint

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

Two decisions that turned out to be linked, both discovered while wiring
`apps/api` to `packages/db`.

## Part 1: the driver must hold interactive transactions

### Context

Neon publishes `@neondatabase/serverless`, whose HTTP mode is the path of least
resistance for serverless deployment. It **cannot hold an interactive
transaction**: each statement is a separate round trip, so transaction-local
state set by one statement is gone by the next.

Two things in this system require that state to survive:

- RLS tenant context, set with `set_config(..., true)` and read by a policy on
  a later statement in the same transaction (ADR 0003)
- the double-entry ledger, which lands in Phase 4 and is meaningless without
  atomic multi-statement writes

### Decision

Plain `node-postgres` over TCP, for both local Docker and Neon. Neon's WebSocket
`Pool` also satisfies the constraint if it is ever preferred.

**A startup assertion fails the boot if the configured driver cannot.** It sets
a transaction-local value and reads it back in a separate statement inside the
same transaction. A driver that cannot returns null.

```
API failed to start: DriverCapabilityError: Driver capability probe failed: ECONNREFUSED
```

Verified: booting against a dead database exits 1 and never opens the port. That
message initially read `probe failed:` with nothing after it, because
node-postgres raises an `AggregateError` with an **empty** message when every
address for a host refuses; the error formatter now falls through code, name and
nested causes.

## Part 2: the workspace is ESM, including NestJS

### Context

`packages/db` and `packages/shared` are ESM. `apps/api` was written as CommonJS,
which is the NestJS convention.

TypeScript raises **TS1479** on a static CommonJS-to-ESM import. Node 24 does
support `require(esm)` at runtime - verified directly against both packages -
but TypeScript refuses to emit it, because it targets a wider range of Node
versions.

### Decision

`apps/api` is ESM: `"type": "module"`, `module` and `moduleResolution` set to
`node16`.

ESM importing CommonJS always works; CommonJS importing ESM does not. So the API
is the side that moves. Decorators are a TypeScript transform and are unaffected
by the module system - `experimentalDecorators` and `emitDecoratorMetadata` work
identically.

`node16` resolution is required so the workspace packages' `exports` maps
resolve; classic `Node` resolution ignores them entirely.

### Consequences

- All relative imports in `apps/api` carry `.js` extensions
- `apps/api` needs `tsconfig.build.json` with `rootDir: "src"`, or `nest build`
  emits `dist/src/main.js` while `pnpm start` looks for `dist/main.js`
- Vitest 4 transforms with **oxc**, not esbuild, and silently ignored the esbuild
  decorator options configured first. `HealthController` therefore takes
  `HealthService` by constructor injection on purpose: if design-time metadata
  ever stops being emitted, that one test goes red instead of a dozen Phase 1
  services failing at once.
