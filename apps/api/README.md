# @nexmarket/api

NestJS 11 on Fastify. REST with an OpenAPI document generated from decorators.

## Layout

```
src/
├── main.ts                    bootstrap: env, driver probe, Swagger, listen
├── configure-app.ts           createAdapter() + plugins, shared with the e2e suite
├── app.module.ts              root module; every domain module registers here
│
├── config/                    configuration and environment
│   ├── env.ts                 zod-validated process.env, fails the boot
│   └── load-dotenv.ts         .env loading, main.ts only
│
├── common/                    cross-cutting, imported by many modules
│   ├── decorators/            @Public, @RequireCapability, @PlatformAdmin, @CurrentUser
│   ├── guards/                AuthGuard (global), AdminGuard (global), CapabilityGuard
│   ├── interceptors/          TenantInterceptor -> withTenant (global)
│   ├── request-context.ts     AsyncLocalStorage carrying the transaction
│   └── pagination.ts          cursor helpers (PRD 13)
│
└── modules/                   one folder per domain area (PRD 7.2)
    ├── auth/                  register · login · refresh · logout · Google OAuth
    ├── orgs/                  seller onboarding, documents, members
    ├── admin/                 the approval queue
    └── health/
```

## Conventions

**One folder per domain module**, named for the domain, holding
`<name>.controller.ts`, `<name>.service.ts`, `<name>.module.ts`, and as they
appear: `dto.ts`, `<name>.repository.ts`, ports and adapters.

**Controllers hold no logic.** They translate HTTP to a service call and back.
Services never import `@nestjs/common` HTTP types beyond the exceptions they
throw.

**Services take their transaction from `getRequestContext()`,** never a `db` or
`pool` handle. A lint rule enforces the import ban (PRD 6.4 criterion 2). There
are exactly two sanctioned exceptions, both liveness-related and both commented
at the import: the boot probe in `main.ts` and `HealthService`.

`getRequestContext()` **throws** outside a request. That is deliberate: code
running outside the interceptor's scope has no tenant context, and a loud
failure beats a silent fall back to an unscoped connection.

**Every route is deny-by-default.** `AuthGuard` and `TenantInterceptor` are
registered globally in `app.module.ts`, so a controller with no decorators is
closed and tenant-scoped. A public route is public because it is explicitly
`@Public()`, never by omission — and `test/route-coverage.e2e.test.ts` enumerates
the router and probes every route to prove it.

**Guards run before interceptors**, always, whatever order the providers are
listed in. That is why the capability check runs inside `TenantInterceptor`
rather than as a second `APP_GUARD`. `AdminGuard` *can* be a guard, because
`platform_role` is a token claim `AuthGuard` has already attached. See ADR 0009.

**Authorise on capabilities, never role names.** `@RequireCapability('member:write')`
survives adding a sub-role; `role === 'OWNER'` does not. ADR 0013.

**The active tenant is the `x-tenant-id` header,** checked against the caller's
memberships before the controller runs. A malformed value is a 400, and a tenant
the caller does not belong to is a 403 — never an empty 200, which would render
as an ordinary empty list and hide the refusal.

**Build the Fastify adapter with `createAdapter()`.** `bodyLimit` is a
constructor option, so a stray `new FastifyAdapter()` silently reverts to
Fastify's 1 MiB default and produces a 413 that no test reproduces.

**File extensions in imports are `.js`.** This package is ESM (`"type":
"module"`), because `@nexmarket/db` and `@nexmarket/shared` are ESM and TypeScript
refuses a static CommonJS-to-ESM import. Decorators are unaffected.

## Tests

**The repo co-locates tests. This package is the one exception, and the line is
THE NEST APPLICATION.**

| Where | Name | For |
|---|---|---|
| `src/**/*.test.ts` | `thing.test.ts` | Tests of one module, run against that module directly. |
| `test/*.e2e.test.ts` | `area.e2e.test.ts` | Tests that boot the app and drive it over HTTP. |

Not "unit versus integration", and not "database versus no database" —
`packages/db` co-locates `catalogue-rls.test.ts` in `src/` and that test starts
a Postgres. What separates the two piles here is whether
`Test.createTestingModule` appears in the file. Nothing outside `apps/api` has
an application to boot, so nothing outside `apps/api` has a second directory.

`pagination`, `password`, `tokens`, `google-state` and `zone-rate.adapter` sit
in `src/` because each is a pure function with an obvious home. `test/` holds
the ones with no single home: `route-coverage` asserts over *every* route,
`tenancy` over every policy, `contract` over the whole published API. (`ledger.e2e`
is the odd one — it drives the database through `withTenant` without booting the
app, and is in `test/` because it is about the ledger as a whole rather than one
file.)

**Why not one central `tests/` tree for the repo:** `packages/shared` enforces
100% coverage on nine named files, and a test beside its source makes "is this
covered" a one-directory question; turbo caches per package, so
`pnpm --filter @nexmarket/db test` needs the tests inside that package; and
`git mv` takes a co-located test with its source, which is how a central tree
avoids accumulating orphans for modules that no longer exist.

Keeping a test pure is therefore a design decision with a visible consequence:
the shipping quote port stayed synchronous and database-free specifically so
`zone-rate.adapter.test.ts` could live in `src/` and run in milliseconds. See
the note at the top of `shipping-quote.port.ts`.

`pnpm test` starts one Postgres via Testcontainers, migrates it and seeds it
before any test file is imported (`test/global-setup.ts`), then runs the files in
parallel against it.

**Namespace test emails per file** (`onboarding-`, `admin-`, …). `users.email`
is globally unique and the files share one database, so a bare
`dupe@example.test` in two files is a 409 for whichever loses the race — green in
a single-file run, red in the suite.

## Modules to come

Per PRD 7.2, each arrives with its phase: `catalogue` (2), `search` (3), `cart`
and `checkout` (4), `orders` and `fulfilment` (5), `logistics` (6), `reviews`
(7), `returns` (8), `promotions` and `loyalty` (9), `ads` (10). `admin` exists
and grows through Phase 11.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | watch mode on port 4000 |
| `pnpm build` | emit to `dist/` via `tsconfig.build.json` |
| `pnpm start` | run the built output |
| `pnpm test` | vitest, in-process via Fastify `inject` |
| `pnpm lint` | eslint over `src` and `test` |

`GET /health` returns service and database liveness. `GET /docs` serves Swagger
UI, `GET /docs-json` the raw OpenAPI document; a test asserts every registered
route appears in it.
