# @hossain/api

NestJS 11 on Fastify. REST with an OpenAPI document generated from decorators.

## Layout

```
src/
├── main.ts                    bootstrap: env, driver probe, Swagger, listen
├── app.module.ts              root module; every domain module registers here
│
├── config/                    configuration and environment
│   └── env.ts                 zod-validated process.env, fails the boot
│
├── common/                    cross-cutting, imported by many modules
│   ├── decorators/            @CurrentUser, @Tenant, @Public, @Capability
│   ├── filters/               exception filters, error shape
│   ├── guards/                Auth, Capability, Tenant  (Phase 1)
│   └── interceptors/          TenantInterceptor -> withTenant  (Phase 1)
│
└── modules/                   one folder per domain area (PRD 7.2)
    └── health/
        ├── health.controller.ts    HTTP surface, OpenAPI decorators
        ├── health.service.ts       behaviour, no HTTP types
        └── health.module.ts        wiring
```

## Conventions

**One folder per domain module**, named for the domain, holding
`<name>.controller.ts`, `<name>.service.ts`, `<name>.module.ts`, and as they
appear: `dto/`, `entities/`, `<name>.repository.ts`.

**Controllers hold no logic.** They translate HTTP to a service call and back.
Services never import `@nestjs/common` HTTP types.

**Database access goes through `withTenant`,** never the raw `db` or `pool`
handle. A lint rule enforces this (PRD 6.4 criterion 2). There are exactly two
sanctioned exceptions, both liveness-related and both commented at the import:
the boot probe in `main.ts` and `HealthService`.

**Every route is deny-by-default** once guards land in Phase 1. A public route
is public because it is explicitly marked, never by omission.

**File extensions in imports are `.js`.** This package is ESM (`"type":
"module"`), because `@hossain/db` and `@hossain/shared` are ESM and TypeScript
refuses a static CommonJS-to-ESM import. Decorators are unaffected.

## Modules to come

Per PRD 7.2, each arrives with its phase: `auth` and `tenancy` (Phase 1),
`catalogue` (2), `search` (3), `cart` and `checkout` (4), `orders` and
`fulfilment` (5), `logistics` (6), `reviews` (7), `returns` (8), `promotions`
and `loyalty` (9), `ads` (10), `admin` (11).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | watch mode on port 4000 |
| `pnpm build` | emit to `dist/` via `tsconfig.build.json` |
| `pnpm start` | run the built output |
| `pnpm test` | vitest, in-process via Fastify `inject` |
| `pnpm lint` | eslint over `src` and `test` |

`GET /health` returns service and database liveness. `GET /docs` serves Swagger
UI, `GET /docs-json` the raw OpenAPI document.
