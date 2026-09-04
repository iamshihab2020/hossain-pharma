# Phase 1 — Tenancy & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a foundation that has forced RLS but no users into an application that knows who the caller is, which organisations they belong to, and which tenant's rows they may touch — with a NestJS interceptor making it impossible for a request to reach the database without a transaction-local tenant context.

**Architecture:** Identity is platform-owned (`users`, `user_identities`, `sessions`); membership is tenant-owned (`org_members`, `seller_documents`) and RLS-enforced against `organisations.id`. Authentication is self-hosted — argon2id password hashes, a 15-minute JWT access token and a 30-day rotating refresh token with reuse detection, plus Google OAuth as a second identity provider onto the same `users` row. Authorisation is capability-based: the §5.3 matrix lives as data in `@nexmarket/shared`, and guards check capability strings, never role names. Every tenant-touching request is wrapped in `withTenant` by a single interceptor, so the tenancy guarantee is a property of the framework rather than of each developer remembering.

**Tech Stack:** TypeScript 5.9.3 (pinned), NestJS 11 on Fastify, Drizzle ORM + Drizzle Kit, `pg` (node-postgres) over TCP, Postgres 16, `@node-rs/argon2`, `jose` for JWT, `@fastify/cookie`, Zod 4, Vitest 4, Testcontainers, Supertest.

**Spec:** `docs/PRD-marketplace-migration.md` (v2.0). Phase 1 is defined in §11; this plan also discharges §5.1, §5.3, §6.2, §6.3, §6.4 (all four blocking criteria), §6.6, §9.2 "Onboarding", §9.3 "Seller governance", and the identity rows of §13.

**Predecessor:** `docs/superpowers/plans/2026-08-23-phase-0-foundation.md`. Phase 0 shipped `organisations`, `countries`, `currencies`, `rls_probe`, `withTenant`, the migration runner, the seed harness, and the boot-time driver assertion. Read `## Phase 0 exit checklist` in that plan before starting.

---

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Tenant context MUST be set with `SET LOCAL` inside a transaction. A session-level `SET` is a cross-tenant data leak.** Use `set_config('app.tenant_id', <value>, true)` — the third argument `true` is what makes it transaction-local. (§6.4)
- **Never import `db` or `pool` from `@nexmarket/db`.** Use `withTenant`. A `no-restricted-imports` lint rule in `packages/config/eslint/index.js` enforces it. Exactly two sanctioned exceptions exist, both liveness-only and both commented at the import site: the boot probe in `apps/api/src/main.ts` and `HealthService`. **This plan adds no third exception.** (§6.4 criterion 2)
- **Every new tenant-owned table needs `ENABLE` + `FORCE ROW LEVEL SECURITY` + policies in a hand-written migration.** Copy the shape from `packages/db/migrations/0001_rls_probe_policies.sql`, including the `NULLIF(current_setting(...), '')::uuid` wrapper — without it a null tenant raises `invalid input syntax for type uuid` instead of returning zero rows.
- **Missing tenant context must return zero rows, never all rows.** (§6.4 criterion 4)
- **Drizzle silently ignores any migration not listed in `migrations/meta/_journal.json`.** Always create hand-written migrations with `pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=<name>`, which writes the file, the journal entry and the snapshot together. A hand-dropped `.sql` file sits in the repo looking applied while never running — for an RLS migration that is a silent security hole, not a broken build.
- **Changing an already-applied migration's contents changes its hash and requires recreating the database.** Migrations `0000` and `0001` are frozen. Never edit them.
- **Money is integer minor units plus an explicit currency.** No floats in any pricing, tax, discount, shipping or ledger path. (§8.4) — Phase 1 touches no pricing path; the constraint is listed so it is not forgotten when `seller_documents` grows a fee field later.
- **Deny by default. No route is public unless explicitly marked.** (§13)
- **Cursor-based pagination is mandatory on every collection endpoint. No endpoint may return an unbounded set.** (§13) — Phase 1 ships its first collection endpoint, the admin approval queue in Task 12. It must be cursor-paginated.
- **`httpOnly` cookies, no token in JS. Refresh rotation with reuse detection. argon2id.** (§13)
- **Zero `any` in `src/`.** (§4.3 S7)
- **Test coverage: ≥ 80% on domain logic, 100% on RLS.** (§13) — in Phase 1 the 100% bar binds `tenant-context.ts` (already enforced), the new capability matrix, and the token-rotation logic.
- **All relative imports carry `.js` extensions.** `packages/db`, `packages/shared` and `apps/api` are ESM. TypeScript raises TS1479 on a static CommonJS-to-ESM import.
- **ASCII-only inside source files** — code, comments, string literals, SQL, and config. Prose in `docs/` may use `§` and em-dashes; source files may not, because they cross encoding boundaries (psql, Docker init scripts, Windows shells) where a stray Unicode character fails obscurely.
- **New dependencies with install scripts must be listed in `pnpm-workspace.yaml` under `allowBuilds`**, or pnpm 11 blocks them silently.
- **Do not bump the pinned dependencies.** `typescript` 5.9.3, `tailwindcss` 3.4.x, `react-day-picker` 9.11.x. Read `docs/architecture/0001` and `0006` before touching any of them.
- **`.npmrc` sets `strict-peer-dependencies=false`,** so a peer mismatch installs silently and fails later. Check what a dependency actually resolves to before writing config against it.
- **Host ports are 5433 (Postgres) and 6380 (Redis),** not the defaults. Run `docker ps` before adding any service to compose.
- **Tests require Docker but no database configuration.** Every suite that touches a database starts its own via Testcontainers. The full suite must keep passing with `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `REDIS_URL` all unset.

---

## Phase 1 scoping decisions

Six interpretive calls, made explicit so an executor does not have to guess. Each becomes an ADR in Task 14.

### D-A. `withTenant` gains a third context value: `app.user_id`

**This is the decision the rest of the phase hangs on. Read it before Task 1.**

`org_members` is tenant-owned (§6.2 — it carries `tenant_id` and is RLS-enforced). But there is a bootstrapping problem: to discover *which* tenant a user may act as, the API must read `org_members` **before it knows any tenant**. With `nexmarket_app` being `NOBYPASSRLS` and the `tenant_isolation` policy in force, that query returns zero rows, always. Login would succeed and every user would appear to belong to no organisation.

Three ways out were considered:

| Option | Verdict |
|---|---|
| Make `org_members` platform-owned (no `tenant_id`) | **Rejected.** §6.2 classifies membership as tenant-owned, and a seller org's member list is exactly the kind of row another tenant must never read. Dropping RLS to solve a lookup problem trades the guarantee for convenience. |
| Read memberships over the owner (migration) connection | **Rejected.** It puts a `BYPASSRLS`-equivalent connection on the login path — the single hottest, most attacker-reachable route in the system. It also creates a third sanctioned raw-handle import, which the global constraints forbid. |
| Add `app.user_id` to the transaction-local context and a second policy on `org_members` | **Chosen.** |

So `TenantContext` becomes `{ tenantId: string | null; userId: string | null; isAdmin: boolean }`, `withTenant` sets a third GUC, and `org_members` carries two policies:

```sql
CREATE POLICY tenant_isolation ON "org_members"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY own_membership ON "org_members"
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
```

Postgres ORs multiple permissive policies, so a row is visible if it belongs to the active tenant **or** to the calling user. `own_membership` is `FOR SELECT` only and deliberately has no `WITH CHECK`: a user may *enumerate* their memberships but may never *write* one outside a tenant context. Self-granting a membership is the obvious attack and this closes it at the database.

Both GUCs still fail closed when unset, by the same `NULLIF` mechanism Phase 0 established.

### D-B. `sessions` stores refresh-token *families*, not tokens

§13 requires "refresh rotation with reuse detection". Reuse detection needs to distinguish "this refresh token is old because it was legitimately rotated" from "this refresh token is old because it was stolen and replayed". A row per token cannot tell them apart once deleted.

So a session row is a **family**: one row per login, carrying the hash of the *currently valid* refresh token, a `generation` counter, and a `revokedAt`. On refresh, the presented token is hashed and compared. If it matches, the row rotates (new hash, `generation + 1`). If it does not match but the family exists and is unrevoked, that is a **replay of a superseded token** — the entire family is revoked immediately and the request is rejected. That is the reuse detection.

Refresh tokens are stored as SHA-256 hashes, not argon2id. They are 256 bits of `crypto.randomBytes` entropy, not user-chosen, so they are not brute-forcible and do not need a slow KDF; using argon2id here would put a ~100 ms cost on every token refresh for no security gain.

### D-C. `users` holds no role column beyond `platform_role`

§5.1 is explicit that seller capability comes from **membership in an org, never from a role field on the user**. `users.platform_role` is `BUYER | ADMIN` only. There is deliberately no `SELLER` value in that enum — the legacy system's mutually-exclusive roles (finding 11) are exactly what this shape exists to prevent. A reviewer adding `SELLER` to `platform_role` has reintroduced the bug.

### D-D. Document upload is metadata-only in Phase 1

§9.2 step 4 requires document upload; §4.2 lists real KYC as a non-goal and §13 requires "signed URLs for KYC documents". Object storage is a §10.5 concern that has no adapter yet. Phase 1 therefore ships `seller_documents` rows with a `storageKey`, a `FileStorage` port with a local-filesystem adapter, and access-logging — but no S3, no signed-URL provider, and no virus scanning. The port is what makes the later swap free. This is a deliberate boundary, not an omission, and Task 11 documents it in the ADR.

### D-E. The interceptor is opt-out by decorator, and the default is scoped

A route with no decorator gets `withTenant({ tenantId: <active org or null>, userId, isAdmin })`. Routes that genuinely serve no tenant — `POST /auth/register`, `POST /auth/login`, `GET /health` — are marked `@Public()`, which also exempts them from the auth guard. There is no "skip the interceptor but keep the guard" state, because every authenticated route either acts as a tenant or acts as the platform, and the platform case is `tenantId: null` plus `isAdmin: true`, which the policies already handle.

Deny-by-default (§13) means the guard is registered **globally** via `APP_GUARD`, not per-controller. A new controller with no decorators is closed, not open.

### D-F. Phase 1 keeps `rls_probe`

It is a canary table with no business meaning. Once `org_members` exists it would be tempting to delete it, but a permanently green isolation test running against a table with nothing else attached is worth keeping: when it goes red the cause is the RLS machinery itself and nothing else. `CLAUDE.md` already says to keep it. Do not drop it.

---

## File Structure

```
packages/shared/src/
├── capabilities.ts                  NEW  the §5.3 matrix as data + resolve()
├── capabilities.test.ts             NEW  100% coverage
└── index.ts                         MOD  re-export capabilities

packages/db/src/
├── tenant-context.ts                MOD  D-A: add userId / app.user_id
├── tenant-context.test.ts           MOD  cover the third GUC
├── schema/
│   ├── users.ts                     NEW  users, user_identities, sessions
│   ├── org-members.ts               NEW  org_members (tenant-owned)
│   ├── seller-documents.ts          NEW  seller_documents (tenant-owned)
│   ├── organisations.ts             MOD  add reviewedAt/reviewedBy/rejectionReason
│   └── index.ts                     MOD  re-export the three new modules
├── seed/
│   ├── users.ts                     NEW  buyers, an admin, seller staff
│   ├── org-members.ts               NEW  memberships (through withTenant — the trap)
│   └── index.ts                     MOD  wire the two new seeders in order
└── migrations/
    ├── 0002_identity_tables.sql     NEW  generated (platform-owned, no RLS)
    ├── 0003_membership_rls.sql      NEW  --custom (ENABLE + FORCE + policies)
    └── meta/_journal.json           MOD  written by drizzle-kit, never by hand

apps/api/src/
├── common/
│   ├── decorators/
│   │   ├── public.decorator.ts      NEW  @Public() — opt out of guard+interceptor
│   │   ├── capabilities.decorator.ts NEW @RequireCapability('product:write')
│   │   └── current-user.decorator.ts NEW @CurrentUser() param decorator
│   ├── guards/
│   │   ├── auth.guard.ts            NEW  global, deny-by-default
│   │   └── capability.guard.ts      NEW  global, checks the §5.3 matrix
│   ├── interceptors/
│   │   └── tenant.interceptor.ts    NEW  PRD 6.4 criterion 1
│   ├── request-context.ts           NEW  AsyncLocalStorage carrying the tx
│   └── pagination.ts                NEW  cursor helpers (§13)
├── modules/
│   ├── auth/                        NEW  register/login/refresh/logout, Google
│   ├── orgs/                        NEW  onboarding, documents, context switch
│   └── admin/                       NEW  approval queue, suspend/reinstate
└── config/env.ts                    MOD  JWT secrets, cookie domain, Google keys

apps/api/test/
├── auth.e2e.test.ts                 NEW
├── tenancy.e2e.test.ts              NEW  §6.4 criteria 1, 3, 4
├── onboarding.e2e.test.ts           NEW  the phase demo, end to end
└── global-setup.ts                  MOD  no change expected; verify it still holds
```

---

## Task 1: Extend the tenant context with `app.user_id`

Everything downstream needs this, and it changes a file whose coverage threshold is 100%. Do it first and alone.

**Files:**
- Modify: `packages/db/src/tenant-context.ts`
- Modify: `packages/db/src/tenant-context.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TenantContext = { readonly tenantId: string | null; readonly userId: string | null; readonly isAdmin: boolean }`, and `makeWithTenant(db)` returning `withTenant<T>(ctx: TenantContext, fn: (tx: Transaction) => Promise<T> | T): Promise<T>` which now sets three GUCs. `Transaction` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/tenant-context.test.ts`, inside the existing describe block that has a live container:

```ts
it('sets app.user_id transaction-locally and reads it back', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const seen = await withTenant({ tenantId: null, userId, isAdmin: false }, async (tx) => {
    const r = await tx.execute(sql`SELECT current_setting('app.user_id', true) AS v`);
    return (r.rows[0] as { v: string | null }).v;
  });
  expect(seen).toBe(userId);
});

it('leaves app.user_id unset after the transaction commits', async () => {
  await withTenant({ tenantId: null, userId: '11111111-1111-4111-8111-111111111111', isAdmin: false }, async () => undefined);
  const r = await pool.query("SELECT current_setting('app.user_id', true) AS v");
  expect(r.rows[0].v).toBeNull();
});

it('writes an empty string for a null userId so NULLIF can fail it closed', async () => {
  const seen = await withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
    const r = await tx.execute(sql`SELECT current_setting('app.user_id', true) AS v`);
    return (r.rows[0] as { v: string | null }).v;
  });
  expect(seen).toBe('');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @nexmarket/db exec vitest run tenant-context`
Expected: FAIL. The first test reports `null` rather than the uuid, because nothing sets the GUC yet. TypeScript also errors on the extra `userId` property, since `TenantContext` does not declare it.

- [ ] **Step 3: Add `userId` to the type and set the third GUC**

In `packages/db/src/tenant-context.ts`, extend the type:

```ts
export type TenantContext = {
  readonly tenantId: string | null;
  /**
   * PRD 5.1. Carried so `org_members` can answer "which orgs does this caller
   * belong to?" BEFORE any tenant is known - the lookup that decides tenantId
   * cannot itself require tenantId. Migration 0003 pairs this with an
   * `own_membership` SELECT-only policy. See plan D-A.
   */
  readonly userId: string | null;
  readonly isAdmin: boolean;
};
```

and add the third `set_config` inside the transaction, immediately after the tenant one:

```ts
await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
```

- [ ] **Step 4: Run the suite and confirm it passes at 100%**

Run: `pnpm --filter @nexmarket/db test`
Expected: PASS, and the coverage table still shows 100% on `tenant-context.ts`. If coverage dropped, a branch is untested — add the case rather than lowering the threshold.

- [ ] **Step 5: Fix the call sites the type change broke**

Run: `pnpm --filter @nexmarket/db type-check` and `pnpm --filter @nexmarket/api type-check`
Every existing `withTenant({ tenantId, isAdmin })` call now fails to compile because `userId` is missing. Add `userId: null` to each. Do not make the property optional — a required field is what forces every future call site to think about it.

- [ ] **Step 6: Stage the work**

```bash
git add packages/db/src/tenant-context.ts packages/db/src/tenant-context.test.ts
```

Leave committing to the operator. Every task in this plan ends staged, not committed, unless the operator says otherwise.

---

## Task 2: Identity schema — `users`, `user_identities`, `sessions`

All three are platform-owned (§6.2): no `tenant_id`, no RLS, admin-guarded at the application layer. This migration is generated, not hand-written, because it expresses nothing `drizzle-kit` cannot.

**Files:**
- Create: `packages/db/src/schema/users.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0002_identity_tables.sql` (generated)

**Interfaces:**
- Consumes: `TenantContext` from Task 1 (not directly, but the seed in Task 6 does).
- Produces: Drizzle tables `users`, `userIdentities`, `sessions`; enums `platformRole` (`BUYER`, `ADMIN`), `userStatus` (`ACTIVE`, `SUSPENDED`, `DELETED`).

- [ ] **Step 1: Write the schema module**

Create `packages/db/src/schema/users.ts`:

```ts
import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * PRD 5.1. BUYER and ADMIN only, deliberately.
 *
 * There is no SELLER value and adding one is a regression. Seller capability
 * comes from membership in an organisation (org_members), never from a field on
 * the user. The legacy system made roles mutually exclusive - verifySeller
 * rejected admins, verifyAdmin rejected sellers - so an admin could not manage
 * their own products. This enum's shape is what prevents that. See plan D-C.
 */
export const platformRole = pgEnum('platform_role', ['BUYER', 'ADMIN']);

export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);

/**
 * Platform-owned (PRD 6.2): no tenant_id, no RLS. Buyers are not tenants; they
 * belong to the platform and shop across all sellers.
 *
 * passwordHash is nullable on purpose: an account created through Google OAuth
 * has no password until it sets one, and a null hash must never be treated as
 * "any password matches". Task 8's verify path checks for null explicitly.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lower-cased by the application. The unique index is what enforces it. */
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    platformRole: platformRole('platform_role').notNull().default('BUYER'),
    status: userStatus('status').notNull().default('ACTIVE'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    legacyMongoId: text('legacy_mongo_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('users_email_key').on(t.email)],
);

/**
 * One row per external identity provider linked to a user. Google OAuth lands
 * here rather than on `users`, so a single account can carry a password AND a
 * Google login AND whatever provider Phase 9 adds, without a column per vendor.
 *
 * D6 dropped Firebase entirely. Every legacy account is invalid by construction.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_identities_provider_account_key').on(t.provider, t.providerAccountId),
    index('user_identities_user_idx').on(t.userId),
  ],
);

/**
 * A refresh token FAMILY, not a token. See plan D-B.
 *
 * refreshTokenHash holds the SHA-256 of the currently valid refresh token.
 * Presenting a token that hashes to something else, while this row is alive,
 * means a superseded token was replayed - so the whole family is revoked. That
 * is the reuse detection PRD 13 requires; a row-per-token cannot express it,
 * because a legitimately rotated token and a stolen one look identical once the
 * old row is gone.
 *
 * SHA-256 rather than argon2id is deliberate: these are 256 bits of
 * crypto.randomBytes, not user-chosen secrets, so a slow KDF buys nothing and
 * would put ~100ms on every refresh.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    generation: text('generation').notNull().default('0'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_hash_idx').on(t.refreshTokenHash),
  ],
);
```

- [ ] **Step 2: Re-export it**

In `packages/db/src/schema/index.ts`, add the line **before** `rls-probe` so the file stays in dependency order:

```ts
export * from './users.js';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @nexmarket/db exec drizzle-kit generate --name=identity_tables`

Expected: creates `migrations/0002_identity_tables.sql` plus a journal entry and a snapshot. Read the generated SQL before continuing — confirm it creates three tables and two enums, and that it does **not** touch `organisations`, `rls_probe`, `countries` or `currencies`. If it proposes dropping anything, stop: the schema modules and the snapshot have diverged and applying it will lose data.

- [ ] **Step 4: Apply and verify**

```bash
docker compose up -d
pnpm db:push
```

Expected: migration `0002` applies cleanly. Then confirm the journal has three entries:

```bash
node -e "console.log(require('./packages/db/migrations/meta/_journal.json').entries.map(e=>e.tag))"
```

Expected output includes `0002_identity_tables`. **If it does not, the migration will never run** and everything downstream silently builds on a missing table.

- [ ] **Step 5: Type-check and stage**

```bash
pnpm --filter @nexmarket/db type-check
git add packages/db/src/schema/users.ts packages/db/src/schema/index.ts packages/db/migrations
```

---

## Task 3: Password hashing — argon2id

Isolated, pure, and fast to test. Doing it before the auth module keeps Task 8 focused on HTTP rather than on cryptography.

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/modules/auth/password.ts`
- Create: `apps/api/src/modules/auth/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashPassword(plain: string): Promise<string>` and `verifyPassword(hash: string | null, plain: string): Promise<boolean>`.

- [ ] **Step 1: Add the dependency and allow its build script**

```bash
pnpm --filter @nexmarket/api add @node-rs/argon2
```

Then add it to `pnpm-workspace.yaml` under `allowBuilds`, with a comment matching the file's existing style:

```yaml
  # argon2id hashing (PRD 13). Ships napi prebuilds; the build step selects the
  # platform binary. Without this pnpm 11 blocks it and every hash call throws
  # at runtime rather than at install time.
  '@node-rs/argon2': true
```

- [ ] **Step 2: Verify the install actually built**

Run: `pnpm install && node -e "import('@node-rs/argon2').then(m=>console.log(typeof m.hash))"`
Expected: `function`. If it prints an error about a missing native binding, the `allowBuilds` entry did not take — fix that before writing any code against it. This is the exact failure shape that cost time in Phase 0 (`ioredis` 6, surprise 4).

- [ ] **Step 3: Write the failing test**

Create `apps/api/src/modules/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for a null hash rather than treating it as a match', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });

  it('returns false for a malformed hash rather than throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm --filter @nexmarket/api exec vitest run password`
Expected: FAIL — `Cannot find module './password.js'`.

- [ ] **Step 5: Implement**

Create `apps/api/src/modules/auth/password.ts`:

```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * PRD 13 requires argon2id. These are the OWASP-recommended minimums as of
 * 2026-08: 19 MiB memory, 2 iterations, 1 degree of parallelism.
 *
 * Do not lower memoryCost to speed up the test suite. If the suite is slow,
 * mark the slow tests, do not weaken the hash - the parameters are the control.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * A null hash means the account has no password - it was created through OAuth
 * and has not set one. That must read as "no password can match", never as
 * "any password matches". A malformed hash is treated the same way: verify
 * throws on garbage input, and an exception on the login path must not become a
 * 500 that distinguishes a real account from a fake one.
 */
export async function verifyPassword(hashed: string | null, plain: string): Promise<boolean> {
  if (hashed === null) return false;
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @nexmarket/api exec vitest run password`
Expected: 5 passed.

- [ ] **Step 7: Stage**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/api/package.json apps/api/src/modules/auth/password.ts apps/api/src/modules/auth/password.test.ts
```

---

## Task 4: The capability matrix as data

§5.3 says permissions are checked as capability strings, not role names, "so the matrix is data rather than code". This lives in `@nexmarket/shared` because both the API guard and (later) the web UI need it, and it must be framework-free.

**Files:**
- Create: `packages/shared/src/capabilities.ts`
- Create: `packages/shared/src/capabilities.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/vitest.config.ts` (add the 100% threshold)

**Interfaces:**
- Consumes: nothing.
- Produces: `type OrgRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'FINANCE'`; `type Capability` (a string union); `ORG_ROLE_CAPABILITIES: Readonly<Record<OrgRole, readonly Capability[]>>`; `hasCapability(roles: readonly OrgRole[], needed: Capability): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ORG_ROLE_CAPABILITIES, hasCapability, type OrgRole } from './capabilities.js';

describe('capabilities', () => {
  it('gives OWNER every capability any role has', () => {
    const all = new Set(Object.values(ORG_ROLE_CAPABILITIES).flat());
    for (const cap of all) {
      expect(ORG_ROLE_CAPABILITIES.OWNER).toContain(cap);
    }
  });

  it('matches the PRD 5.3 matrix for STAFF', () => {
    expect(hasCapability(['STAFF'], 'order:write')).toBe(true);
    expect(hasCapability(['STAFF'], 'product:read')).toBe(true);
    expect(hasCapability(['STAFF'], 'product:write')).toBe(false);
    expect(hasCapability(['STAFF'], 'payout:read')).toBe(false);
    expect(hasCapability(['STAFF'], 'member:write')).toBe(false);
  });

  it('matches the PRD 5.3 matrix for FINANCE', () => {
    expect(hasCapability(['FINANCE'], 'payout:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'payout:write')).toBe(true);
    expect(hasCapability(['FINANCE'], 'analytics:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'order:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'order:write')).toBe(false);
    expect(hasCapability(['FINANCE'], 'product:write')).toBe(false);
  });

  it('matches the PRD 5.3 matrix for MANAGER', () => {
    expect(hasCapability(['MANAGER'], 'product:write')).toBe(true);
    expect(hasCapability(['MANAGER'], 'analytics:read')).toBe(true);
    expect(hasCapability(['MANAGER'], 'payout:read')).toBe(true);
    expect(hasCapability(['MANAGER'], 'payout:write')).toBe(false);
    expect(hasCapability(['MANAGER'], 'member:write')).toBe(false);
  });

  it('unions capabilities when a user holds two roles in one org', () => {
    expect(hasCapability(['STAFF', 'FINANCE'], 'payout:write')).toBe(true);
    expect(hasCapability(['STAFF', 'FINANCE'], 'order:write')).toBe(true);
    expect(hasCapability(['STAFF', 'FINANCE'], 'member:write')).toBe(false);
  });

  it('denies when the role list is empty', () => {
    expect(hasCapability([], 'product:read')).toBe(false);
  });

  it('denies an unknown role rather than throwing', () => {
    expect(hasCapability(['NOPE' as OrgRole], 'product:read')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @nexmarket/shared exec vitest run capabilities`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the matrix**

Create `packages/shared/src/capabilities.ts`:

```ts
/**
 * PRD 5.3, expressed as data.
 *
 * Guards check capability strings, never role names. That is the whole point:
 * adding a sub-role or moving one permission is a change to this table, not a
 * change to every call site. A guard that reads `role === 'OWNER'` has
 * reintroduced exactly the coupling this table exists to remove.
 */
export type OrgRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'FINANCE';

export type Capability =
  | 'product:read'
  | 'product:write'
  | 'order:read'
  | 'order:write'
  | 'analytics:read'
  | 'payout:read'
  | 'payout:write'
  | 'member:read'
  | 'member:write'
  | 'settings:read'
  | 'settings:write';

/**
 * Read straight off the PRD 5.3 table. A tick is read+write, an eye is read
 * only, a dash is neither.
 *
 *          Products Orders Analytics Finance Members Settings
 * OWNER       rw      rw       rw       rw      rw       rw
 * MANAGER     rw      rw       rw       r       -        r
 * STAFF       r       rw       -        -       -        -
 * FINANCE     -       r        rw       rw      -        -
 */
export const ORG_ROLE_CAPABILITIES: Readonly<Record<OrgRole, readonly Capability[]>> = {
  OWNER: [
    'product:read', 'product:write',
    'order:read', 'order:write',
    'analytics:read',
    'payout:read', 'payout:write',
    'member:read', 'member:write',
    'settings:read', 'settings:write',
  ],
  MANAGER: [
    'product:read', 'product:write',
    'order:read', 'order:write',
    'analytics:read',
    'payout:read',
    'settings:read',
  ],
  STAFF: ['product:read', 'order:read', 'order:write'],
  FINANCE: ['order:read', 'analytics:read', 'payout:read', 'payout:write'],
};

/**
 * Union across roles. One human can hold several roles in one org, and the
 * answer is the union, never the maximum or the first match.
 *
 * An unrecognised role contributes nothing rather than throwing: this runs
 * inside a guard, and a guard that throws on unexpected data fails open in some
 * framework configurations. Contributing nothing fails closed.
 */
export function hasCapability(roles: readonly OrgRole[], needed: Capability): boolean {
  return roles.some((role) => ORG_ROLE_CAPABILITIES[role]?.includes(needed) ?? false);
}
```

- [ ] **Step 4: Re-export and set the coverage threshold**

In `packages/shared/src/index.ts` add:

```ts
export {
  ORG_ROLE_CAPABILITIES,
  hasCapability,
  type Capability,
  type OrgRole,
} from './capabilities.js';
```

In `packages/shared/vitest.config.ts`, add `capabilities.ts` alongside `money.ts` in the 100% coverage threshold list. It is an authorisation table; a missed branch is a missed permission.

- [ ] **Step 5: Run and confirm green at 100%**

Run: `pnpm --filter @nexmarket/shared test`
Expected: 7 new tests pass; coverage reports 100% on `capabilities.ts`.

- [ ] **Step 6: Stage**

```bash
git add packages/shared/src/capabilities.ts packages/shared/src/capabilities.test.ts packages/shared/src/index.ts packages/shared/vitest.config.ts
```

---

## Task 5: `org_members` and `seller_documents` — the RLS migration

**The most dangerous task in the phase.** A mistake here is silent: the tables exist, the policies look present, and isolation does not happen. Read `packages/db/migrations/0001_rls_probe_policies.sql` in full before starting.

**Files:**
- Create: `packages/db/src/schema/org-members.ts`
- Create: `packages/db/src/schema/seller-documents.ts`
- Modify: `packages/db/src/schema/organisations.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0003_membership_rls.sql` (via `--custom`)
- Create: `packages/db/src/membership-rls.test.ts`

**Interfaces:**
- Consumes: `users` (Task 2), `organisations` (Phase 0), `TenantContext.userId` (Task 1).
- Produces: Drizzle tables `orgMembers`, `sellerDocuments`; enum `orgRole` (`OWNER`, `MANAGER`, `STAFF`, `FINANCE`), enum `documentType`, enum `documentStatus`.

- [ ] **Step 1: Write the schema modules**

Create `packages/db/src/schema/org-members.ts`:

```ts
import { index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { users } from './users.js';

/** PRD 5.3. Mirrors ORG_ROLE_CAPABILITIES in @nexmarket/shared; keep them in step. */
export const orgRole = pgEnum('org_role', ['OWNER', 'MANAGER', 'STAFF', 'FINANCE']);

/**
 * TENANT-OWNED (PRD 6.2). Migration 0003 puts ENABLE + FORCE + policies on it.
 *
 * This is the join table that makes PRD 5.1 work: one human can own one org,
 * work as staff in another, and shop as a buyer, all at once. The legacy system
 * could not express that because the role lived on the user.
 *
 * tenant_id is the organisation. It is named tenant_id rather than
 * organisation_id so every tenant-owned table in the codebase carries the same
 * column name and the RLS policy is copy-pasteable without renaming.
 */
export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('org_members_tenant_user_role_key').on(t.tenantId, t.userId, t.role),
    index('org_members_user_idx').on(t.userId),
    index('org_members_tenant_idx').on(t.tenantId),
  ],
);
```

Create `packages/db/src/schema/seller-documents.ts`:

```ts
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { users } from './users.js';

/** PRD 9.2 onboarding step 4. Mock KYC - see plan D-D, no real verification. */
export const documentType = pgEnum('document_type', ['TRADE_LICENCE', 'NATIONAL_ID', 'BANK_PROOF']);

export const documentStatus = pgEnum('document_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

/**
 * TENANT-OWNED. Migration 0003 puts ENABLE + FORCE + policies on it.
 *
 * storageKey is an opaque handle owned by the FileStorage port, not a URL and
 * not a filesystem path. Phase 1 ships a local-filesystem adapter; PRD 13 wants
 * signed URLs, which arrives with object storage in a later phase. Nothing
 * outside the port may interpret this string.
 */
export const sellerDocuments = pgTable(
  'seller_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    type: documentType('type').notNull(),
    status: documentStatus('status').notNull().default('PENDING'),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seller_documents_tenant_idx').on(t.tenantId)],
);
```

- [ ] **Step 2: Add the review columns to `organisations`**

§9.3 requires approve/reject with reason. In `packages/db/src/schema/organisations.ts`, add to the table definition, after `legacyMongoId`:

```ts
  /** PRD 9.3 seller governance. Set by the admin approval queue in Task 12. */
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
```

`reviewedBy` deliberately carries **no** foreign key to `users`. `organisations.ts` is imported by `users.ts`'s dependency chain in the other direction, and a circular import between schema modules breaks Drizzle's relation inference. The referential integrity is enforced in the service layer; note this in the ADR.

- [ ] **Step 3: Re-export both modules**

In `packages/db/src/schema/index.ts`, after the `users` line:

```ts
export * from './org-members.js';
export * from './seller-documents.js';
```

- [ ] **Step 4: Generate the table migration**

Run: `pnpm --filter @nexmarket/db exec drizzle-kit generate --name=membership_tables`

This creates the tables and enums but **no RLS** — drizzle-kit cannot express policies. Read the SQL and confirm it only adds. Apply it: `pnpm db:push`.

- [ ] **Step 5: Create the RLS migration with `--custom`**

```bash
pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=membership_rls
```

**Use `--custom`. Not a hand-dropped file.** `--custom` writes the `.sql`, the journal entry and the snapshot together. A file created any other way is invisible to Drizzle and never runs, and for this migration that means zero tenant isolation on the membership table while every eyeball says the policy is there.

- [ ] **Step 6: Write the policy SQL**

Fill the generated `migrations/0004_membership_rls.sql` (take the number drizzle-kit actually assigned):

```sql
-- PRD 6.3 and 6.4. Hand-written because drizzle-kit cannot express RLS.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables. ENABLE alone is decoration.

ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seller_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seller_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- NULLIF(..., '') is load-bearing. withTenant writes an empty string for a null
-- tenant, and ''::uuid raises "invalid input syntax for type uuid". NULLIF turns
-- it back into NULL, and `tenant_id = NULL` is NULL rather than TRUE, so an
-- unset context yields ZERO rows. PRD 6.4 criterion 4: fail closed, never open.
CREATE POLICY tenant_isolation ON "org_members"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- The bootstrap policy. See the Phase 1 plan, decision D-A.
--
-- To decide WHICH tenant a caller may act as, the API must read org_members
-- BEFORE any tenant is known. Under tenant_isolation alone that read returns
-- zero rows and every user appears to belong to no organisation.
--
-- FOR SELECT only, and deliberately no WITH CHECK: a user may enumerate their
-- own memberships and may never write one outside a tenant context.
-- Self-granting a membership is the obvious attack; this closes it in the
-- database rather than in a service method someone can forget to call.
--
-- Postgres ORs permissive policies, so a row is visible when it belongs to the
-- active tenant OR to the calling user.
CREATE POLICY own_membership ON "org_members"
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY platform_admin_bypass ON "org_members"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "seller_documents"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- Admins review documents across every tenant. That IS the approval queue.
CREATE POLICY platform_admin_bypass ON "seller_documents"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- 0001 granted on ALL TABLES as of that moment, plus DEFAULT PRIVILEGES for
-- tables created later BY THE SAME ROLE. Re-granting explicitly is cheap and
-- removes the dependency on that assumption holding.
GRANT SELECT, INSERT, UPDATE, DELETE ON "org_members" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "seller_documents" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_identities" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO nexmarket_app;
```

- [ ] **Step 7: Write the isolation proof**

Create `packages/db/src/membership-rls.test.ts`. Model it on the existing `tenant-context.test.ts` container setup — start Postgres via Testcontainers, run migrations over the owner URL, then connect a second pool as `nexmarket_app`.

```ts
it('returns ZERO rows for org_members when no tenant context is set', async () => {
  const rows = await withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) =>
    tx.execute(sql`SELECT id FROM org_members`),
  );
  expect(rows.rows).toHaveLength(0);
});

it('shows tenant A only its own members', async () => {
  const rows = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, async (tx) =>
    tx.execute(sql`SELECT tenant_id FROM org_members`),
  );
  expect(rows.rows).not.toHaveLength(0);
  expect(rows.rows.every((r) => (r as { tenant_id: string }).tenant_id === orgA)).toBe(true);
});

it('lets a user enumerate their own memberships with NO tenant context', async () => {
  const rows = await withTenant({ tenantId: null, userId: karimId, isAdmin: false }, async (tx) =>
    tx.execute(sql`SELECT tenant_id FROM org_members`),
  );
  // Karim owns orgA and is STAFF in orgB - PRD 5.1's headline case.
  const tenants = rows.rows.map((r) => (r as { tenant_id: string }).tenant_id).sort();
  expect(tenants).toEqual([orgA, orgB].sort());
});

it('does NOT let a user insert a membership without a tenant context', async () => {
  await expect(
    withTenant({ tenantId: null, userId: karimId, isAdmin: false }, async (tx) =>
      tx.execute(
        sql`INSERT INTO org_members (tenant_id, user_id, role) VALUES (${orgB}, ${karimId}, 'OWNER')`,
      ),
    ),
  ).rejects.toThrow(/row-level security/i);
});

it('does not leak seller_documents across tenants', async () => {
  const rows = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, async (tx) =>
    tx.execute(sql`SELECT tenant_id FROM seller_documents`),
  );
  expect(rows.rows.every((r) => (r as { tenant_id: string }).tenant_id === orgA)).toBe(true);
});
```

The fourth test is the important one — it proves `own_membership` cannot be used to escalate. If it passes when it should fail, the policy has a `WITH CHECK` it should not have.

- [ ] **Step 8: Run, and read the failure carefully if it fails**

Run: `pnpm --filter @nexmarket/db exec vitest run membership-rls`
Expected: all pass. `permission denied for table` means a `GRANT` is missing, not an RLS failure — they look alike and are not.

- [ ] **Step 9: Verify FORCE actually landed**

Do not trust the migration; ask the database:

```bash
docker compose exec -T postgres psql -U postgres -d nexmarket -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('org_members','seller_documents','rls_probe');"
```

Expected: `t | t` on all three rows. A `t | f` means `FORCE` is missing and the owner bypasses everything.

- [ ] **Step 10: Stage**

```bash
git add packages/db/src/schema packages/db/migrations packages/db/src/membership-rls.test.ts
```

---

## Task 6: Seed users and memberships — the zero-rows trap

**Read this before writing any seed code.** The Phase 0 seed connects as `nexmarket_app` and works only because no Phase 0 table has RLS enabled. `org_members` and `seller_documents` now do. The same pattern here **inserts zero rows and reports success** — no error, no exception, just an empty table.

**Files:**
- Create: `packages/db/src/seed/users.ts`
- Create: `packages/db/src/seed/org-members.ts`
- Modify: `packages/db/src/seed/index.ts`
- Modify: `packages/db/src/seed/seed.test.ts`

**Interfaces:**
- Consumes: `users`, `orgMembers` schema; `makeWithTenant` from Task 1; `hashPassword` — **no**, see step 2.
- Produces: `seedUsers(db): Promise<number>`, `seedOrgMembers(db): Promise<number>`; `SeedSummary` gains `users` and `orgMembers`.

- [ ] **Step 1: Write the failing test first**

Add to `packages/db/src/seed/seed.test.ts`:

```ts
it('actually inserts org_members rows despite RLS', async () => {
  await seed(db);
  // Counted over the OWNER connection: the point is that the rows exist at all,
  // not that the app role can see them.
  const r = await ownerPool.query('SELECT count(*)::int AS n FROM org_members');
  expect(r.rows[0].n).toBeGreaterThan(0);
});

it('is idempotent for users and memberships', async () => {
  await seed(db);
  const first = await ownerPool.query('SELECT count(*)::int AS n FROM org_members');
  await seed(db);
  const second = await ownerPool.query('SELECT count(*)::int AS n FROM org_members');
  expect(second.rows[0].n).toBe(first.rows[0].n);
});

it('gives one user memberships in two different orgs (PRD 5.1)', async () => {
  await seed(db);
  const r = await ownerPool.query(
    `SELECT user_id, count(DISTINCT tenant_id)::int AS orgs
       FROM org_members GROUP BY user_id HAVING count(DISTINCT tenant_id) > 1`,
  );
  expect(r.rows.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run and watch it fail in the interesting way**

Run: `pnpm --filter @nexmarket/db exec vitest run seed`
Expected: the first test fails with `expected 0 to be greater than 0` — **not** with an error. That silent zero is the trap this task exists to defuse. Confirm you see it before fixing it; an executor who never sees the failure will not recognise it in a later phase.

- [ ] **Step 3: Seed users (platform-owned, no tenant needed)**

Create `packages/db/src/seed/users.ts`. Note the hash: `packages/db` must **not** depend on `@node-rs/argon2` — it is an API concern, and adding a native dependency to the db package pulls it into the worker and the ETL too. Use a pre-computed argon2id hash constant for the seed's shared demo password, with the plaintext in the comment.

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * argon2id hash of "nexmarket-demo" at the Task 3 parameters.
 *
 * Hard-coded rather than computed so packages/db does not take a native
 * dependency on @node-rs/argon2 - which would pull it into the worker and the
 * ETL for no reason. Regenerate with:
 *   node -e "import('@node-rs/argon2').then(a=>a.hash('nexmarket-demo',{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log))"
 *
 * Demo credentials only. Never seeded into a production database.
 */
const DEMO_PASSWORD_HASH = '<paste the hash produced by the command above>';

const USERS = [
  { email: 'admin@nexmarket.test', displayName: 'Shihab', platformRole: 'ADMIN' as const },
  { email: 'karim@acme.test', displayName: 'Karim Rahman', platformRole: 'BUYER' as const },
  { email: 'nadia@acme.test', displayName: 'Nadia Islam', platformRole: 'BUYER' as const },
  { email: 'tanvir@acme.test', displayName: 'Tanvir Ahmed', platformRole: 'BUYER' as const },
  { email: 'rina@buyer.test', displayName: 'Rina Chowdhury', platformRole: 'BUYER' as const },
] as const;

export async function seedUsers(db: Db): Promise<number> {
  await db
    .insert(schema.users)
    .values(USERS.map((u) => ({ ...u, passwordHash: DEMO_PASSWORD_HASH })))
    .onConflictDoNothing({ target: schema.users.email });
  return USERS.length;
}
```

**Step 3a:** run the `node -e` command in that comment and paste the real hash in. Leaving the placeholder is a plan failure — the seed will insert an unusable hash and login will fail with no obvious cause.

- [ ] **Step 4: Seed memberships through `withTenant` — the fix**

Create `packages/db/src/seed/org-members.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import { makeWithTenant } from '../tenant-context.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * THE TRAP, and the fix.
 *
 * org_members is RLS-enforced with FORCE, and the seed connects as
 * nexmarket_app, which is NOBYPASSRLS on purpose. A plain
 * `db.insert(orgMembers)` therefore inserts ZERO rows and throws nothing - the
 * WITH CHECK on tenant_isolation silently rejects every row whose tenant it
 * cannot attribute. The seed reports success against an empty table.
 *
 * Every insert here goes through withTenant so a tenant context exists for the
 * row being written. The alternative - running this part of the seed on the
 * owner connection - was rejected: it would mean the seed never exercises the
 * policies, so a broken policy would show up in production rather than here.
 * Seeding through the app role makes the seed itself an RLS test.
 *
 * Karim deliberately holds OWNER in acme-electronics AND STAFF in
 * meridian-fashion. That is PRD 5.1's headline claim - one human, several orgs,
 * different roles - and the seed is where it is either true or obviously false.
 */
const MEMBERSHIPS = [
  { orgSlug: 'acme-electronics', email: 'karim@acme.test', role: 'OWNER' as const },
  { orgSlug: 'acme-electronics', email: 'nadia@acme.test', role: 'STAFF' as const },
  { orgSlug: 'acme-electronics', email: 'tanvir@acme.test', role: 'FINANCE' as const },
  { orgSlug: 'meridian-fashion', email: 'karim@acme.test', role: 'STAFF' as const },
  { orgSlug: 'meridian-fashion', email: 'nadia@acme.test', role: 'MANAGER' as const },
] as const;

export async function seedOrgMembers(db: Db): Promise<number> {
  const withTenant = makeWithTenant(db);

  const orgs = await db
    .select({ id: schema.organisations.id, slug: schema.organisations.slug })
    .from(schema.organisations);
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);

  const orgBySlug = new Map(orgs.map((o) => [o.slug, o.id]));
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));

  let inserted = 0;
  for (const m of MEMBERSHIPS) {
    const tenantId = orgBySlug.get(m.orgSlug);
    const userId = userByEmail.get(m.email);
    if (tenantId === undefined || userId === undefined) {
      throw new Error(`Seed inconsistency: no org "${m.orgSlug}" or user "${m.email}"`);
    }
    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      await tx
        .insert(schema.orgMembers)
        .values({ tenantId, userId, role: m.role })
        .onConflictDoNothing();
    });
    inserted += 1;
  }
  return inserted;
}
```

Note the explicit `throw` on a missing org or user. A seed that silently skips rows is the same class of bug as the one this whole task is about.

- [ ] **Step 5: Wire both into the harness in dependency order**

In `packages/db/src/seed/index.ts`, extend `SeedSummary` with `users: number; orgMembers: number;` and the `seed` function body:

```ts
const reference = await seedReferenceData(db);
const organisations = await seedOrganisations(db);
const users = await seedUsers(db);
const orgMembers = await seedOrgMembers(db);
return { ...reference, organisations, users, orgMembers };
```

Order matters: memberships need both orgs and users to exist.

- [ ] **Step 6: Run the seed tests**

Run: `pnpm --filter @nexmarket/db exec vitest run seed`
Expected: all pass, including the two idempotency assertions. Then run it against a live database twice to confirm end to end:

```bash
pnpm seed && pnpm seed
```

Expected: identical `Seeded:` summaries both times, with non-zero `orgMembers`.

- [ ] **Step 7: Stage**

```bash
git add packages/db/src/seed
```

---

## Task 7: JWT issue / verify and refresh rotation

Pure logic, no HTTP. Tested against a real database for the session table but with no web layer, which keeps Task 8 about routing.

**Files:**
- Modify: `apps/api/package.json` (add `jose`)
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`
- Create: `apps/api/src/modules/auth/tokens.ts`
- Create: `apps/api/src/modules/auth/tokens.test.ts`

**Interfaces:**
- Consumes: `sessions` schema (Task 2).
- Produces: `issueAccessToken(payload: AccessTokenPayload, secret: Uint8Array): Promise<string>`; `verifyAccessToken(token: string, secret: Uint8Array): Promise<AccessTokenPayload | null>`; `mintRefreshToken(): { token: string; hash: string }`; `hashRefreshToken(token: string): string`; `type AccessTokenPayload = { sub: string; email: string; platformRole: 'BUYER' | 'ADMIN' }`.

- [ ] **Step 1: Add `jose` and the environment variables**

```bash
pnpm --filter @nexmarket/api add jose @fastify/cookie
```

`jose` is pure JS with no install script, so `allowBuilds` needs no entry — verify with `pnpm why jose` rather than assuming.

In `apps/api/src/config/env.ts` add to the zod schema:

```ts
  /** Minimum 32 bytes. A short secret makes HS256 forgeable, so this is a floor, not a style rule. */
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
```

Add the same block to `.env.example` with development values and a comment saying the secrets must be replaced in any deployed environment.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/auth/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashRefreshToken, issueAccessToken, mintRefreshToken, verifyAccessToken } from './tokens.js';

const secret = new TextEncoder().encode('a'.repeat(32));

describe('tokens', () => {
  it('round-trips an access token', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      900,
    );
    expect(await verifyAccessToken(token, secret)).toMatchObject({ sub: 'u1', email: 'a@b.test' });
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      900,
    );
    const other = new TextEncoder().encode('b'.repeat(32));
    expect(await verifyAccessToken(token, other)).toBeNull();
  });

  it('returns null for an expired token rather than throwing', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      -1,
    );
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('returns null for garbage', async () => {
    expect(await verifyAccessToken('not.a.token', secret)).toBeNull();
  });

  it('mints refresh tokens with 256 bits of entropy and a stable hash', () => {
    const a = mintRefreshToken();
    const b = mintRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toHaveLength(64);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).not.toBe(a.token);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `pnpm --filter @nexmarket/api exec vitest run tokens`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `apps/api/src/modules/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  platformRole: 'BUYER' | 'ADMIN';
};

/**
 * PRD 13: access tokens are short-lived (15 minutes by default) because they
 * are not revocable. Revocation happens at the refresh boundary, against the
 * sessions table, which is why the access TTL is the real blast radius of a
 * stolen token.
 */
export async function issueAccessToken(
  payload: AccessTokenPayload,
  secret: Uint8Array,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ email: payload.email, platformRole: payload.platformRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

/**
 * Returns null on every failure - bad signature, expiry, malformed input.
 *
 * Never throw from here. This runs inside a guard, and distinguishing "expired"
 * from "forged" in the response is an oracle an attacker can probe.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    const role = payload.platformRole;
    if (role !== 'BUYER' && role !== 'ADMIN') return null;
    return { sub: payload.sub, email: payload.email, platformRole: role };
  } catch {
    return null;
  }
}

/**
 * 256 bits from the CSPRNG. Not a JWT: a refresh token carries no claims, it is
 * a lookup key into `sessions`, so there is nothing to encode and nothing to
 * verify offline.
 *
 * SHA-256 rather than argon2id for storage - see plan D-B. These are not
 * user-chosen secrets and cannot be brute-forced, so a slow KDF costs ~100ms
 * per refresh and buys nothing.
 */
export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 5: Run and confirm green**

Run: `pnpm --filter @nexmarket/api exec vitest run tokens`
Expected: 5 passed.

- [ ] **Step 6: Stage**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config/env.ts .env.example apps/api/src/modules/auth/tokens.ts apps/api/src/modules/auth/tokens.test.ts
```

---

## Task 8: The auth module — register, login, refresh, logout

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Create: `apps/api/src/modules/auth/dto.ts`
- Create: `apps/api/src/common/decorators/public.decorator.ts`
- Modify: `apps/api/src/main.ts` (register `@fastify/cookie`)
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/auth.e2e.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 3); `issueAccessToken`/`mintRefreshToken`/`hashRefreshToken` (Task 7); `users`/`sessions` (Task 2); `withTenant` (Task 1).
- Produces: `AuthService.register(input): Promise<AuthResult>`, `.login(input): Promise<AuthResult>`, `.refresh(rawToken): Promise<AuthResult>`, `.logout(rawToken): Promise<void>`, where `AuthResult = { accessToken: string; refreshToken: string; user: { id: string; email: string; displayName: string; platformRole: 'BUYER' | 'ADMIN' } }`. Decorator `@Public()` and its metadata key `IS_PUBLIC_KEY`.

- [ ] **Step 1: Write the `@Public()` decorator**

Create `apps/api/src/common/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'nexmarket:isPublic';

/**
 * PRD 13: deny by default. The auth guard and the tenant interceptor are both
 * registered globally, so a route with no decorator is CLOSED. This opts a
 * route out of both - see plan D-E. Use it only where there is genuinely no
 * caller identity yet: register, login, refresh, health.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 2: Write the failing e2e test**

Create `apps/api/test/auth.e2e.test.ts`. It uses the existing `global-setup.ts`, so no container wiring is needed here.

```ts
it('registers a user and sets an httpOnly refresh cookie', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'New@Example.test', password: 'a-good-password', displayName: 'New' },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().user.email).toBe('new@example.test'); // lower-cased
  expect(res.json()).not.toHaveProperty('refreshToken'); // never in the body
  const cookie = res.cookies.find((c) => c.name === 'nexmarket_refresh');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
});

it('rejects a duplicate email without revealing which field collided', async () => {
  await register('dupe@example.test');
  const res = await register('dupe@example.test');
  expect(res.statusCode).toBe(409);
});

it('logs in and returns an access token', async () => {
  await register('login@example.test');
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'login@example.test', password: 'a-good-password' },
  });
  expect(res.statusCode).toBe(200);
  expect(typeof res.json().accessToken).toBe('string');
});

it('gives the same error for a wrong password and an unknown email', async () => {
  const unknown = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { email: 'nobody@example.test', password: 'whatever' },
  });
  await register('known@example.test');
  const wrong = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { email: 'known@example.test', password: 'wrong-password' },
  });
  expect(unknown.statusCode).toBe(401);
  expect(wrong.statusCode).toBe(401);
  expect(unknown.json().message).toBe(wrong.json().message);
});

it('rotates the refresh token, invalidating the old one', async () => {
  const first = await registerAndGetRefresh('rotate@example.test');
  const second = await refreshWith(first);
  expect(second.statusCode).toBe(200);
  const replay = await refreshWith(first);
  expect(replay.statusCode).toBe(401);
});

it('revokes the whole family when a superseded token is replayed', async () => {
  const first = await registerAndGetRefresh('reuse@example.test');
  const secondToken = extractRefresh(await refreshWith(first));
  await refreshWith(first);            // the replay - detected here
  const after = await refreshWith(secondToken); // the good token must now be dead too
  expect(after.statusCode).toBe(401);
});
```

The last test is the one that matters. Rotation alone is easy; **reuse detection killing the whole family** is the §13 requirement, and it is what turns a stolen token into a detected incident rather than a silent parallel session.

- [ ] **Step 3: Run and confirm it fails**

Run: `pnpm --filter @nexmarket/api exec vitest run auth.e2e`
Expected: FAIL — no `/auth/register` route.

- [ ] **Step 4: Implement `AuthService`**

Create `apps/api/src/modules/auth/auth.service.ts`. The refresh path is the part to get exactly right:

```ts
/**
 * PRD 13 reuse detection. See plan D-B for why sessions are families.
 *
 * Three outcomes:
 *  - hash matches a live family  -> rotate: new token, generation + 1
 *  - hash matches nothing        -> unknown token, reject (401)
 *  - family exists but the hash is stale -> REPLAY. Revoke the entire family
 *    and reject. This is the case that distinguishes a stolen token from a
 *    normally rotated one, and it is why the old hash is kept rather than
 *    deleted on rotation.
 */
async refresh(rawToken: string): Promise<AuthResult> {
  const presented = hashRefreshToken(rawToken);
  return this.withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
    const [live] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.refreshTokenHash, presented), isNull(sessions.revokedAt)))
      .limit(1);

    if (live !== undefined) {
      if (live.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Invalid session');
      const next = mintRefreshToken();
      await tx.update(sessions)
        .set({
          refreshTokenHash: next.hash,
          generation: String(Number(live.generation) + 1),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, live.id));
      return this.buildResult(tx, live.userId, next.token);
    }

    // Not live. Was it EVER this family's token? A revoked row carrying this
    // hash means a superseded token came back - which is the attack signature.
    const [stale] = await tx
      .select().from(sessions)
      .where(eq(sessions.refreshTokenHash, presented)).limit(1);
    if (stale !== undefined) {
      await tx.update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'refresh_token_reuse_detected' })
        .where(eq(sessions.userId, stale.userId));
    }
    throw new UnauthorizedException('Invalid session');
  });
}
```

**Important:** for the replay case to be detectable, rotation must *retain* the superseded hash somewhere. Implement rotation as "insert a new row for the family and mark the old row revoked with reason `rotated`", rather than updating one row in place — otherwise the old hash is gone and step 6's test cannot pass. Adjust the code above accordingly when you implement it: the shape above shows the decision logic, and the storage choice is yours to make consistent.

- [ ] **Step 5: Implement the controller, DTOs and module**

- Validate every body with Zod (`zod` 4 is already a dependency), not `class-validator` — the codebase has no `class-validator` and adding one would mean two validation stories.
- `POST /auth/register` returns **201**, `POST /auth/login` and `/auth/refresh` return **200**, `POST /auth/logout` returns **204**.
- Set the refresh token as a cookie named `nexmarket_refresh`, `httpOnly: true`, `sameSite: 'lax'`, `secure: env.COOKIE_SECURE`, `path: '/auth'`. **The refresh token must never appear in a response body** (§13: no token in JS).
- Lower-case the email before both insert and lookup.
- Register `@fastify/cookie` in `main.ts` before `app.listen`.
- Mark all four routes `@Public()`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @nexmarket/api exec vitest run auth.e2e`
Expected: all pass, including the family-revocation test.

- [ ] **Step 7: Stage**

```bash
git add apps/api/src/modules/auth apps/api/src/common/decorators apps/api/src/main.ts apps/api/src/app.module.ts apps/api/test/auth.e2e.test.ts
```

---

## Task 9: Google OAuth

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/modules/auth/google.controller.ts`
- Create: `apps/api/src/modules/auth/google.service.ts`
- Create: `apps/api/test/google-oauth.e2e.test.ts`

**Interfaces:**
- Consumes: `userIdentities`/`users` (Task 2); `AuthService.issueForUser(userId)` (extract this from Task 8's `buildResult` so both paths share it).
- Produces: `GET /auth/google` (redirect) and `GET /auth/google/callback`.

- [ ] **Step 1: Decide the library and verify what it resolves to**

D6 specifies "Google OAuth via Passport". Before writing config against it:

```bash
pnpm --filter @nexmarket/api add @nestjs/passport passport passport-google-oauth20
pnpm --filter @nexmarket/api add -D @types/passport-google-oauth20
pnpm why passport-google-oauth20
```

Record the resolved majors. Phase 0's most expensive lesson was writing config against an assumed version — five dependencies resolved to majors beyond what the PRD assumed, and three failed silently.

- [ ] **Step 2: Write the failing test**

Google's endpoints must not be contacted in CI. Test the two things that are ours:

```ts
it('links a Google identity to an existing user by verified email', async () => {
  await register('linkme@example.test');
  const result = await googleService.upsertFromProfile({
    provider: 'google', providerAccountId: 'g-123',
    email: 'linkme@example.test', emailVerified: true, displayName: 'Link Me',
  });
  const identities = await countIdentitiesFor(result.user.id);
  expect(identities).toBe(1);
  expect(await countUsersWithEmail('linkme@example.test')).toBe(1); // linked, not duplicated
});

it('refuses to link on an UNVERIFIED google email', async () => {
  await register('victim@example.test');
  await expect(
    googleService.upsertFromProfile({
      provider: 'google', providerAccountId: 'g-evil',
      email: 'victim@example.test', emailVerified: false, displayName: 'Evil',
    }),
  ).rejects.toThrow();
});

it('creates a new passwordless user when the email is unknown', async () => {
  const result = await googleService.upsertFromProfile({
    provider: 'google', providerAccountId: 'g-456',
    email: 'brandnew@example.test', emailVerified: true, displayName: 'Brand New',
  });
  expect(result.user.email).toBe('brandnew@example.test');
  expect(await passwordHashFor(result.user.id)).toBeNull();
});
```

The second test is the security-critical one. Auto-linking on an unverified email is full account takeover: anyone who can create a Google account claiming `victim@example.test` inherits the victim's account. `email_verified` must be checked, and the test is what keeps a future refactor from dropping the check.

- [ ] **Step 3: Run, implement, re-run**

Run: `pnpm --filter @nexmarket/api exec vitest run google-oauth` — expect failure, implement `upsertFromProfile` with the verified-email guard, re-run to green.

Make the routes conditional on `GOOGLE_CLIENT_ID` being set: the strategy must not be registered when the variable is absent, or a clean clone with no Google credentials fails to boot and breaks success criterion S4.

- [ ] **Step 4: Stage**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/auth apps/api/test/google-oauth.e2e.test.ts
```

---

## Task 10: The `TenantInterceptor` and the global guards

**PRD 6.4 criterion 1 — the item Phase 0 deliberately deferred.** This is the phase's headline deliverable.

**Files:**
- Create: `apps/api/src/common/request-context.ts`
- Create: `apps/api/src/common/interceptors/tenant.interceptor.ts`
- Create: `apps/api/src/common/guards/auth.guard.ts`
- Create: `apps/api/src/common/guards/capability.guard.ts`
- Create: `apps/api/src/common/decorators/capabilities.decorator.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Modify: `apps/api/src/app.module.ts` (register `APP_GUARD` / `APP_INTERCEPTOR`)
- Create: `apps/api/test/tenancy.e2e.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 7); `hasCapability` (Task 4); `withTenant` (Task 1); `orgMembers` (Task 5).
- Produces: `RequestContext = { userId: string; platformRole: 'BUYER' | 'ADMIN'; tenantId: string | null; roles: readonly OrgRole[]; tx: Transaction }`, exposed through `getRequestContext(): RequestContext`; `@RequireCapability(cap)`; `@CurrentUser()`.

- [ ] **Step 1: Build the request context store**

Create `apps/api/src/common/request-context.ts` using `AsyncLocalStorage`. The interceptor opens the `withTenant` transaction and runs the rest of the request inside it, so services obtain the transaction handle from here rather than importing `db`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from '@nexmarket/db';
import type { OrgRole } from '@nexmarket/shared';

export type RequestContext = {
  readonly userId: string;
  readonly platformRole: 'BUYER' | 'ADMIN';
  readonly tenantId: string | null;
  readonly roles: readonly OrgRole[];
  readonly tx: Transaction;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Throws when called outside a request. That is deliberate: a service reaching
 * for the transaction outside the interceptor's scope has no tenant context,
 * and the correct outcome is a loud failure rather than a silent fallback to a
 * raw connection. The raw handle is exactly what PRD 6.4 criterion 2 bans.
 */
export function getRequestContext(): RequestContext {
  const ctx = storage.getStore();
  if (ctx === undefined) {
    throw new Error('No request context: this code ran outside the TenantInterceptor');
  }
  return ctx;
}
```

- [ ] **Step 2: Write the failing tenancy test**

Create `apps/api/test/tenancy.e2e.test.ts`, covering §6.4 criteria 1, 3 and 4 at the HTTP layer:

```ts
it('rejects an unauthenticated request to a non-public route (deny by default)', async () => {
  const res = await app.inject({ method: 'GET', url: '/orgs/mine' });
  expect(res.statusCode).toBe(401);
});

it('scopes a tenant-selected request to that tenant only', async () => {
  const karim = await loginAs('karim@acme.test');
  const res = await app.inject({
    method: 'GET', url: '/orgs/members',
    headers: { authorization: `Bearer ${karim.accessToken}`, 'x-tenant-id': acmeId },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().items.every((m) => m.tenantId === acmeId)).toBe(true);
});

it('refuses a tenant header for an org the user does not belong to', async () => {
  const rina = await loginAs('rina@buyer.test'); // member of nothing
  const res = await app.inject({
    method: 'GET', url: '/orgs/members',
    headers: { authorization: `Bearer ${rina.accessToken}`, 'x-tenant-id': acmeId },
  });
  expect(res.statusCode).toBe(403);
});

it('lets one user switch context between two orgs (PRD 5.1)', async () => {
  const karim = await loginAs('karim@acme.test');
  const mine = await app.inject({
    method: 'GET', url: '/orgs/mine',
    headers: { authorization: `Bearer ${karim.accessToken}` },
  });
  const slugs = mine.json().items.map((o) => o.slug).sort();
  expect(slugs).toEqual(['acme-electronics', 'meridian-fashion']);
});

it('enforces capabilities, not role names', async () => {
  const nadia = await loginAs('nadia@acme.test'); // STAFF in acme
  const res = await app.inject({
    method: 'POST', url: '/orgs/members',
    headers: { authorization: `Bearer ${nadia.accessToken}`, 'x-tenant-id': acmeId },
    payload: { email: 'rina@buyer.test', role: 'STAFF' },
  });
  expect(res.statusCode).toBe(403); // STAFF lacks member:write
});

// PRD 6.4 criterion 3 - the concurrency proof, at the HTTP layer this time.
it('shows zero cross-reads under interleaved two-tenant load', async () => {
  const karim = await loginAs('karim@acme.test');
  const requests = Array.from({ length: 40 }, (_, i) =>
    app.inject({
      method: 'GET', url: '/orgs/members',
      headers: {
        authorization: `Bearer ${karim.accessToken}`,
        'x-tenant-id': i % 2 === 0 ? acmeId : meridianId,
      },
    }),
  );
  const results = await Promise.all(requests);
  results.forEach((res, i) => {
    const expected = i % 2 === 0 ? acmeId : meridianId;
    expect(res.json().items.every((m) => m.tenantId === expected)).toBe(true);
  });
});
```

The last test is criterion 3 and success criterion S1. Phase 0 proved it at the `withTenant` layer; this proves it survives the pool, the framework and the interceptor.

- [ ] **Step 3: Implement the auth guard**

Global, deny-by-default. Reads `Authorization: Bearer`, calls `verifyAccessToken`, attaches the payload to the request, and returns `true` immediately for `@Public()` routes. Anything else with no valid token is 401.

- [ ] **Step 4: Implement the interceptor**

For a non-public route: read the optional `x-tenant-id` header, open `withTenant({ tenantId: null, userId, isAdmin })` to read the caller's memberships (this is what D-A's `own_membership` policy makes possible), verify the requested tenant is among them — **403 if not** — then open the real `withTenant({ tenantId, userId, isAdmin })` and run the handler inside `runWithContext`.

Two memberships lookups in one request is one more round trip than strictly necessary; accept it for now. Caching membership in the access token would make revocation lag by the token TTL, which is the wrong trade for an authorisation decision. Note this in the ADR.

- [ ] **Step 5: Implement the capability guard and decorators**

`@RequireCapability('member:write')` sets metadata; the guard reads `getRequestContext().roles` and calls `hasCapability`. A platform `ADMIN` passes every capability check — that is what `isAdmin` means — but note that admin access to *rows* comes from the `platform_admin_bypass` policy, not from this guard. Both are needed and they are not the same mechanism.

- [ ] **Step 6: Register both guards and the interceptor globally**

In `app.module.ts`:

```ts
providers: [
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  { provide: APP_GUARD, useClass: CapabilityGuard },
],
```

Order matters: `AuthGuard` must run before `CapabilityGuard`, and the interceptor must open the transaction before the capability guard reads roles from the context. Verify the actual execution order with a test rather than assuming NestJS's documented order holds under Fastify.

- [ ] **Step 7: Run and confirm green**

Run: `pnpm --filter @nexmarket/api exec vitest run tenancy.e2e`
Expected: all pass. If the concurrency test is flaky, it is a real finding — do not retry it away.

- [ ] **Step 8: Stage**

```bash
git add apps/api/src/common apps/api/src/app.module.ts apps/api/test/tenancy.e2e.test.ts
```

---

## Task 11: Seller onboarding and document upload

**Files:**
- Create: `apps/api/src/modules/orgs/` (controller, service, module, dto)
- Create: `apps/api/src/modules/orgs/file-storage.port.ts`
- Create: `apps/api/src/modules/orgs/local-file-storage.adapter.ts`
- Create: `apps/api/test/onboarding.e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: `POST /orgs` (create, `DRAFT`), `PATCH /orgs/:id` (business details), `POST /orgs/:id/documents` (upload), `POST /orgs/:id/submit` (`DRAFT` -> `PENDING_REVIEW`), `GET /orgs/mine`, `GET /orgs/members`, `POST /orgs/members` (invite). `FileStorage` port: `put(bytes, meta): Promise<{ storageKey: string }>`, `get(storageKey): Promise<Buffer>`.

- [ ] **Step 1: Write the lifecycle test first**

The §6.6 state machine is the thing to protect. Illegal transitions must be rejected by the service, not merely absent from the UI:

```ts
it('creates an org in DRAFT and makes the creator its OWNER', async () => { /* ... */ });
it('refuses to submit an org with no documents', async () => { /* ... */ });
it('moves DRAFT -> PENDING_REVIEW on submit', async () => { /* ... */ });
it('refuses to submit an org already in PENDING_REVIEW', async () => { /* ... */ });
it('refuses ACTIVE -> PENDING_REVIEW', async () => { /* ... */ });
it('refuses to let a member of another org read these documents', async () => { /* ... */ });
```

- [ ] **Step 2: Write the state machine as data, mirroring §6.6**

```ts
/** PRD 6.6. DRAFT -> PENDING_REVIEW -> ACTIVE <-> SUSPENDED -> CLOSED. */
const ALLOWED_TRANSITIONS: Readonly<Record<OrgStatus, readonly OrgStatus[]>> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['ACTIVE', 'DRAFT'],   // DRAFT is "rejected, fix and resubmit"
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};
```

A transition not in this table is a 409, and the table is the only place the rule lives.

- [ ] **Step 3: Implement the `FileStorage` port and local adapter**

Per D-D: the port's interface is what the later object-storage adapter implements. The local adapter writes under a configurable directory with a random `storageKey`, and **must not** use the original filename in the path — a user-supplied filename in a filesystem path is a traversal bug.

- [ ] **Step 4: Implement the controller and service, run the tests to green**

Run: `pnpm --filter @nexmarket/api exec vitest run onboarding.e2e`

- [ ] **Step 5: Stage**

```bash
git add apps/api/src/modules/orgs apps/api/test/onboarding.e2e.test.ts
```

---

## Task 12: The admin approval queue

**Files:**
- Create: `apps/api/src/modules/admin/` (controller, service, module)
- Create: `apps/api/src/common/pagination.ts`
- Modify: `apps/api/test/onboarding.e2e.test.ts` (extend to the full demo path)

**Interfaces:**
- Consumes: Task 11's org lifecycle; `platform_admin_bypass` policy (Task 5).
- Produces: `GET /admin/orgs?status=PENDING_REVIEW&cursor=&limit=` (cursor-paginated), `POST /admin/orgs/:id/approve`, `POST /admin/orgs/:id/reject`, `POST /admin/orgs/:id/suspend`, `POST /admin/orgs/:id/reinstate`.

- [ ] **Step 1: Write the cursor pagination helper and its test**

§13 makes this mandatory on **every** collection endpoint, and this is the first one. Encode the cursor as base64 of `{ createdAt, id }` — an offset cursor drifts when rows are inserted mid-pagination, and the approval queue is exactly a list that grows while being read.

```ts
it('returns a stable page when a new row is inserted mid-pagination', async () => { /* ... */ });
it('rejects a limit above the maximum rather than honouring it', async () => { /* ... */ });
it('returns nextCursor: null on the last page', async () => { /* ... */ });
```

- [ ] **Step 2: Write the phase acceptance test — the §11 demo, end to end**

```ts
it('runs the full Phase 1 demo: register -> create org -> submit -> approve -> ACTIVE', async () => {
  const seller = await registerAndLogin('newseller@example.test');
  const org = await createOrg(seller, { slug: 'novel-goods', legalName: 'Novel Goods Ltd' });
  await uploadDocument(seller, org.id, 'TRADE_LICENCE');
  await submitForReview(seller, org.id);

  const admin = await loginAs('admin@nexmarket.test');
  const queue = await adminQueue(admin, 'PENDING_REVIEW');
  expect(queue.items.map((o) => o.id)).toContain(org.id);

  await approve(admin, org.id);
  expect((await getOrg(seller, org.id)).status).toBe('ACTIVE');
});

it('rejects with a reason and returns the org to DRAFT', async () => { /* ... */ });

// PRD 6.6 and the Phase 1 acceptance criterion, verbatim:
// "Suspended seller can still fulfil open orders."
it('keeps order-fulfilment access for a SUSPENDED seller', async () => {
  // Phase 1 has no orders yet. Assert the mechanism that will carry it:
  // a SUSPENDED org still resolves as an active tenant context, and only
  // listing/selling capabilities are withdrawn.
  const suspended = await suspendedOrgContext();
  expect(suspended.canResolveTenant).toBe(true);
  expect(suspended.capabilities).toContain('order:write');
  expect(suspended.capabilities).not.toContain('product:write');
});
```

That third test is honest about a real limitation: there are no orders until Phase 4, so it asserts the mechanism rather than the outcome. Say so in the test name and the comment rather than claiming a stronger guarantee than the phase can deliver.

- [ ] **Step 3: Implement, run to green, stage**

```bash
git add apps/api/src/modules/admin apps/api/src/common/pagination.ts apps/api/test
```

---

## Task 13: The four §6.4 criteria, discharged and evidenced

No new features. This task proves the phase's blocking acceptance criteria and writes the evidence down.

- [ ] **Step 1: Criterion 1 — the interceptor wraps every tenant-touching request**

Write a test that enumerates the registered routes and asserts each is either `@Public()` or covered by the interceptor. A hand-maintained list rots; reflection over the router does not.

```ts
it('leaves no route both non-public and un-intercepted', () => {
  const routes = listRegisteredRoutes(app);
  const uncovered = routes.filter((r) => !r.isPublic && !r.hasTenantInterceptor);
  expect(uncovered).toEqual([]);
});
```

- [ ] **Step 2: Criterion 2 — the lint rule holds**

Run: `pnpm lint`
Then deliberately break it: add `import { db } from '@nexmarket/db';` to a service, re-run lint, confirm it **fails**, then revert. A lint rule nobody has seen fail is a lint rule nobody knows works.

- [ ] **Step 3: Criterion 3 — the concurrency proof**

Already written in Task 10 step 2. Run it 10 times and confirm it is stable:

```bash
for i in $(seq 1 10); do pnpm --filter @nexmarket/api exec vitest run tenancy.e2e -t "zero cross-reads" || break; done
```

Note: a shell loop's exit status is the last iteration's, not the worst — hence `|| break`. This exact trap landed a failing commit in Phase 0 (surprise 6).

- [ ] **Step 4: Criterion 4 — missing context returns zero rows**

Covered in Task 5 step 7 and Task 10 step 2. Confirm both suites pass, and confirm the `rls_probe` canary from Phase 0 is still green — if it went red during this phase, the RLS machinery itself regressed.

- [ ] **Step 5: Run all four gates**

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

Record the actual counts. Do not round them, and do not report a gate as green without seeing its output.

---

## Task 14: Documentation truth pass

Success criterion G6: every documented claim is true. This is the phase's last task and it is not optional.

- [ ] **Step 1: Write the ADRs**

- `0008-user-id-in-tenant-context.md` — decision D-A, including the two rejected alternatives and why the `own_membership` policy is `FOR SELECT` with no `WITH CHECK`.
- `0009-refresh-token-families.md` — decision D-B, including why SHA-256 rather than argon2id.
- `0010-capability-matrix-as-data.md` — §5.3 as data, and why guards never read role names.
- `0011-file-storage-port.md` — decision D-D and the Phase-1 boundary.

- [ ] **Step 2: Update `CLAUDE.md`**

Add to the tenancy section: `TenantContext` now carries `userId`; `org_members` carries the `own_membership` bootstrap policy; the seed inserts memberships through `withTenant` and a plain insert would silently write zero rows.

- [ ] **Step 3: Update `README.md` and verify every claim**

Read each sentence and check it against the repo. This is the discipline that made `ef060ec` a commit whose message could honestly say "a README whose claims are all verified".

- [ ] **Step 4: Confirm the OpenAPI document lists every new route**

```bash
pnpm --filter @nexmarket/api dev &
curl -s localhost:4000/docs-json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).paths).sort().join('\n')))"
```

Every route from Tasks 8–12 must appear. §4.3 S6 requires CI to assert documented endpoints exist and respond.

- [ ] **Step 5: Stage the documentation**

```bash
git add docs README.md CLAUDE.md
```

---

## Phase 1 exit checklist

Do not call the phase done until every line is checked, with output seen rather than assumed.

- [ ] `pnpm lint && pnpm type-check && pnpm test && pnpm build` all green; counts recorded
- [ ] Coverage still 100% on `money.ts`, `tenant-context.ts`, `assert-driver.ts`, and now `capabilities.ts`
- [ ] §6.4 criterion 1 — no route is both non-public and un-intercepted (test, not inspection)
- [ ] §6.4 criterion 2 — lint rule seen to FAIL on a deliberate raw-`db` import, then reverted
- [ ] §6.4 criterion 3 — the concurrency test passes 10 consecutive runs
- [ ] §6.4 criterion 4 — missing tenant context returns zero rows on `org_members` and `seller_documents`
- [ ] `pg_class.relforcerowsecurity` is `true` for `org_members`, `seller_documents` and `rls_probe`
- [ ] The Phase 0 `rls_probe` canary is still green
- [ ] `pnpm seed` twice produces identical summaries, with non-zero `orgMembers`
- [ ] One seeded user holds roles in two different orgs, and can switch context over HTTP
- [ ] Refresh-token replay revokes the entire family
- [ ] Google OAuth refuses to link on an unverified email
- [ ] The admin queue is cursor-paginated and rejects an oversized limit
- [ ] `_journal.json` lists every migration file present on disk, and nothing else
- [ ] Four new ADRs written; README and CLAUDE.md claims re-verified
- [ ] Clean-clone spin-up still under the S4 ten-minute budget

---

## Self-review notes

**Spec coverage.** §11 Phase 1 lists nine scope items: `users`/`organisations`/`org_members`/`sessions` (Tasks 2, 5 — `organisations` existed from Phase 0 and gains review columns), argon2id (Task 3), JWT access + refresh rotation (Tasks 7, 8), Google OAuth (Task 9), capability guards (Tasks 4, 10), RLS policies + `withTenant` interceptor (Tasks 5, 10), seller onboarding with document upload (Task 11), admin approval queue (Task 12). All nine map to a task. The three §11 acceptance criteria map to Task 13 (the four §6.4 criteria), Task 10 step 2 test 4 (one user, two orgs), and Task 12 step 2 test 3 (suspended seller).

**Known gaps, stated rather than hidden.**

- **"Suspended seller can still fulfil open orders" cannot be fully proven in Phase 1** — there are no orders until Phase 4. Task 12 asserts the mechanism and says so in the test name. Phase 4 must revisit it with a real order.
- **`user_identities` and `addresses`.** §8.1 maps the Mongo `user` collection to five tables including `addresses`. Addresses belong to checkout and are Phase 4 scope; they are deliberately not in this plan.
- **Rate limiting** (§13) is not in this plan. It belongs with the reverse proxy and Redis configuration, and applying it to the auth routes specifically would be half a solution. Flag it for Phase 12 or raise it if the auth routes are exposed publicly before then.
- **`reviewedBy` on `organisations` carries no foreign key**, to avoid a circular import between schema modules. Enforced in the service layer; recorded in Task 5 step 2 and the ADR.
- **The ETL load stage still waits on Phase 4.** Unchanged from Phase 0.

**Type consistency.** `TenantContext` gains `userId` in Task 1 and every later task uses that three-field shape. `OrgRole` is defined once in `@nexmarket/shared` (Task 4) and the `org_role` pgEnum in Task 5 mirrors it — these are two declarations of one list and are the most likely thing to drift; Task 14 step 2 should note it. `Capability` strings used in Tasks 10 and 12 (`member:write`, `product:write`, `order:write`) all exist in the Task 4 union.
