# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repository from three dead generations of code into a working pnpm + Turborepo monorepo where `pnpm i && pnpm db:push && pnpm seed && pnpm dev` succeeds on a clean machine, CI is green, and the database connection is provably capable of the interactive transactions that RLS and the ledger depend on.

**Architecture:** A pnpm workspace driven by Turborepo. Three apps (`api` on NestJS/Fastify, `web` on Next.js 15, `worker` on BullMQ) consume four packages (`db`, `shared`, `config`, `api-client`). All database access goes through `packages/db`, which owns the Drizzle schema, the connection pool, the migration set, and the `withTenant` transaction wrapper. Development and test run against local Postgres and Redis in Docker Compose; Neon is the deployed target and uses the identical `node-postgres` TCP driver, so no code path differs between the two.

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, NestJS 11 (Fastify adapter), Next.js 15 (App Router), Drizzle ORM + Drizzle Kit, `pg` (node-postgres), Postgres 16, Redis 7, BullMQ, Zod, Vitest, Testcontainers, Supertest, GitHub Actions.

**Spec:** `docs/PRD-marketplace-migration.md` (v2.0). Phase 0 is defined in §11; this plan also discharges the salvage work in §12.1 and the driver constraint in §6.5.

---

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **Money is integer minor units plus an explicit currency.** `type Money = { amount: number; currency: string }` where `amount` is in paisa/cents. **No floats in any pricing, tax, discount, shipping, or ledger path.** (§8.4)
- **Tenant context MUST be set with `SET LOCAL` inside a transaction. A session-level `SET` is a cross-tenant data leak.** Use `set_config('app.tenant_id', <value>, true)` — the third argument `true` is what makes it transaction-local. (§6.4)
- **The API must use the WebSocket `Pool` or plain `node-postgres` over TCP.** Neon's HTTP driver cannot hold interactive transactions. This plan uses plain `node-postgres` over TCP for both local and Neon. (§6.5)
- **A startup assertion fails fast if the configured driver cannot open a multi-statement transaction.** (§6.5, acceptance criterion)
- **Zero `any` in `src/`.** (§4.3 S7)
- **Cursor-based pagination is mandatory on every collection endpoint. No endpoint may return an unbounded set.** (§13) — no collection endpoints exist in Phase 0; the lint rule that enforces this arrives in Phase 2.
- **Test coverage: ≥ 80% on domain logic, 100% on pricing, ledger, and RLS.** (§13) — in Phase 0 this binds `packages/shared` money helpers and `packages/db` tenant-context helpers.
- **Deny by default.** No route is public unless explicitly marked. (§13)
- **Version floors:** Node ≥ 22 (developed on 24.15.0), pnpm ≥ 10 (developed on 11.0.9), NestJS 11, Next.js 15, Postgres 16.
- **Do not pin dependency versions by hand in this plan.** Steps use `pnpm add <pkg>` without a version so pnpm resolves the current release. Task 14 records the resolved versions in an ADR. Inventing a version number that does not exist is a plan failure.
- **ASCII-only inside source files** — code, comments, string literals, SQL, and config. Prose in `docs/` follows the existing PRD convention and may use `§` and em-dashes; source files may not, because they cross encoding boundaries (psql, Docker init scripts, Windows shells) where a stray Unicode character fails obscurely.

---

## Phase 0 scoping decisions

Three interpretive calls, made explicit so an executor does not have to guess.

**D-A. Local Docker Postgres is the dev and test database. Neon is the deploy and CI-branch target.**
Success criterion S4 requires a clean machine to reach a running app in under 10 minutes. Requiring a Neon account breaks that. Both targets use the same `pg` driver over TCP, so §6.5 holds identically and no application code branches on which one is in use. Neon wiring is isolated in Task 13 and is the only task that needs credentials.

**D-B. Phase 0's "base schema" is the tenancy root plus shared-reference data, not the domain.**
Phase 1 owns `users`, `sessions`, `org_members` and the real RLS policies. Phase 0 ships `countries`, `currencies` (shared-reference, world-readable) and `organisations` (the tenant root that every later tenant-owned table will reference). The RLS machinery itself is built and proven in Task 7 against a purpose-built table, `rls_probe`, which exists specifically to prove isolation works before any real data depends on it.

**D-C. `pnpm db:push` runs migrations, it does not run `drizzle-kit push`.**
`drizzle-kit push` diffs the schema and cannot express `CREATE POLICY`, `FORCE ROW LEVEL SECURITY`, or role grants. Those are hand-written SQL in the migration set. The PRD's documented one-liner `pnpm db:push` is kept as the public name because it appears in the README and in S4; it is implemented as `drizzle-kit migrate`. Task 6 documents this in the ADR so the mismatch is deliberate rather than confusing.

---

## File Structure

```
nexmarket/
├── package.json                     workspace root, scripts, engines
├── pnpm-workspace.yaml              workspace globs
├── turbo.json                       task graph and caching
├── tsconfig.json                    root solution file
├── .npmrc                           pnpm settings
├── .gitignore                       rewritten for the monorepo
├── .env.example                     every variable, documented
├── docker-compose.yml               postgres 16 + redis 7
├── .github/workflows/ci.yml         lint, type-check, test, build
├── .github/workflows/neon-branch.yml  branch-per-PR (credential-gated)
│
├── apps/
│   ├── api/                         NestJS on Fastify
│   │   ├── src/main.ts              bootstrap, driver assertion, OpenAPI
│   │   ├── src/app.module.ts        root module
│   │   ├── src/env.ts               zod-validated environment
│   │   └── src/health/              health controller + module
│   ├── web/                         Next.js 15 App Router
│   │   ├── app/layout.tsx           root layout
│   │   ├── app/page.tsx             placeholder landing
│   │   ├── components/ui/           32 salvaged shadcn primitives
│   │   └── lib/utils.ts             cn() helper
│   └── worker/                      BullMQ consumers
│       └── src/main.ts              worker bootstrap + graceful shutdown
│
├── packages/
│   ├── config/                      tsconfig bases, eslint, tailwind preset
│   │   ├── tsconfig/base.json
│   │   ├── tsconfig/nextjs.json
│   │   ├── tsconfig/node.json
│   │   ├── eslint/index.js
│   │   ├── tailwind/preset.ts       salvaged theme tokens
│   │   └── tailwind/globals.css     salvaged CSS variables
│   ├── shared/                      framework-free domain primitives
│   │   ├── src/money.ts             Money type + arithmetic + allocate
│   │   └── src/index.ts
│   ├── db/                          the only module that touches Postgres
│   │   ├── src/client.ts            Pool + drizzle instance
│   │   ├── src/assert-driver.ts     §6.5 startup assertion
│   │   ├── src/tenant-context.ts    withTenant (§6.4)
│   │   ├── src/schema/index.ts      barrel
│   │   ├── src/schema/reference.ts  countries, currencies
│   │   ├── src/schema/organisations.ts
│   │   ├── src/seed/index.ts        seed harness entry
│   │   ├── drizzle.config.ts
│   │   └── migrations/              generated SQL + hand-written RLS
│   └── api-client/                  generated from OpenAPI (stub in Phase 0)
│
├── scripts/mongo-etl/               extract / transform / load / verify
│   └── src/
│       ├── types.ts                 typed shapes of the 8 Mongo collections
│       ├── extract.ts
│       ├── transform.ts
│       ├── verify.ts
│       └── main.ts
│
├── docs/
│   ├── PRD-marketplace-migration.md
│   ├── architecture/                ADRs
│   ├── runbook/
│   └── superpowers/plans/
│
└── archive/                         old-code/ and frontend/ land here
```

---

## Task 1: Monorepo skeleton and the archive move

**Files:**
- Create: `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `tsconfig.json`
- Modify: `package.json` (does not exist at root yet — create), `.gitignore` (rewrite)
- Move: `old-code/` and `frontend/` into `archive/`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm install` at the repo root; the workspace globs `apps/*`, `packages/*`, `scripts/*` that every later task relies on; the Turborepo task names `lint`, `type-check`, `test`, `build`, `dev`.

- [ ] **Step 1: Move the legacy code to `archive/` using `git mv` so history follows**

```bash
mkdir -p archive
git mv old-code archive/old-code
git mv frontend archive/frontend
```

Do NOT delete anything. §12.1 requires `archive/old-code/server-side/` as the reference for the ETL schema mapping, and Task 10 copies 32 files out of `archive/frontend/components/ui/`.

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'scripts/*'
```

- [ ] **Step 3: Create the root `package.json`**

```json
{
  "name": "nexmarket",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@11.0.9",
  "engines": {
    "node": ">=22",
    "pnpm": ">=10"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "test": "turbo run test",
    "db:generate": "pnpm --filter @nexmarket/db run generate",
    "db:push": "pnpm --filter @nexmarket/db run migrate",
    "db:migrate": "pnpm --filter @nexmarket/db run migrate",
    "seed": "pnpm --filter @nexmarket/db run seed",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down"
  },
  "devDependencies": {}
}
```

`db:push` is aliased to `migrate` deliberately — see scoping decision D-C.

- [ ] **Step 4: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
link-workspace-packages=true
```

- [ ] **Step 5: Install Turborepo and TypeScript at the root**

```bash
pnpm add -Dw turbo typescript @types/node prettier
```

- [ ] **Step 6: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["NODE_ENV", "DATABASE_URL", "REDIS_URL"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "type-check": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 7: Create the root `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "packages/config" },
    { "path": "packages/shared" },
    { "path": "packages/db" }
  ]
}
```

More references are added by later tasks as those packages appear.

- [ ] **Step 8: Rewrite `.gitignore` for the monorepo**

The existing file has a Prisma section (wrong ORM), ignores `MODERNIZATION_PLAN.md` (a file that no longer exists), and has no Turborepo entry. Replace its contents with:

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
out/
.next/
*.tsbuildinfo

# Turborepo
.turbo/

# Testing
coverage/
*.lcov

# Environment
.env
.env.local
.env.*.local

# Drizzle introspection scratch
packages/db/drizzle/meta/_journal.json.bak

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
logs/

# Docker
docker-compose.override.yml
dump.rdb

# OS and editors
.DS_Store
Thumbs.db
.idea/
.vscode/*
!.vscode/extensions.json
*.swp

# Deploy
.vercel
```

- [ ] **Step 9: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error. `pnpm turbo --version` prints a 2.x version.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: convert repo to pnpm+turborepo monorepo, archive legacy code"
```

---

## Task 2: `packages/config` — shared tsconfig, eslint, and the salvaged Tailwind theme

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig/base.json`, `packages/config/tsconfig/node.json`, `packages/config/tsconfig/nextjs.json`, `packages/config/eslint/index.js`, `packages/config/tailwind/preset.ts`, `packages/config/tailwind/globals.css`
- Read from: `archive/frontend/tailwind.config.ts`, `archive/frontend/app/globals.css`

**Interfaces:**
- Consumes: the workspace from Task 1.
- Produces: package name `@nexmarket/config`. Consumers extend `@nexmarket/config/tsconfig/node.json` or `.../nextjs.json`, and Tailwind consumers do `presets: [require('@nexmarket/config/tailwind/preset')]`.

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@nexmarket/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig", "eslint", "tailwind"],
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/node.json": "./tsconfig/node.json",
    "./tsconfig/nextjs.json": "./tsconfig/nextjs.json",
    "./eslint": "./eslint/index.js",
    "./tailwind/preset": "./tailwind/preset.ts",
    "./tailwind/globals.css": "./tailwind/globals.css"
  },
  "scripts": {
    "lint": "echo 'no lint for config package'",
    "type-check": "echo 'no type-check for config package'"
  }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig/base.json`**

`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on because S7 demands zero `any` and these are where implicit unsoundness usually hides.

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create `packages/config/tsconfig/node.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Create `packages/config/tsconfig/nextjs.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

- [ ] **Step 5: Copy the salvaged Tailwind theme**

The archived config is 110 lines. Copy it wholesale, then delete the two keys that must not be inherited.

```bash
mkdir -p packages/config/tailwind
cp archive/frontend/app/globals.css packages/config/tailwind/globals.css
cp archive/frontend/tailwind.config.ts packages/config/tailwind/preset.ts
```

Now edit `packages/config/tailwind/preset.ts` and make exactly four changes, leaving `theme.extend` byte-for-byte as it is:

1. **Delete the `content: [...]` array.** Those globs point at `./pages`, `./components`, `./app` relative to the old app root. Every consumer declares its own; an inherited glob silently scans the wrong directories and Tailwind emits no classes for the real ones.
2. **Delete `plugins: [require('tailwindcss-animate')]`.** A preset that `require`s a plugin forces every consumer to install it. Consumers declare it themselves (Task 10 Step 4 does).
3. Change the type annotation from `Config` to `Omit<Config, 'content'>` so a re-added `content` key becomes a type error.
4. Rename the exported const from `config` to `preset`.

The result:

```ts
import type { Config } from 'tailwindcss';

const preset = {
  darkMode: ['class'],
  theme: {
    extend: {
      // ...the full theme.extend block copied unchanged from the archived config:
      // colors (including the custom success/warning/danger/verified scales),
      // borderRadius, keyframes, and animation.
    },
  },
} satisfies Omit<Config, 'content'>;

export default preset;
```

The theme uses `hsl(var(--token))` indirection throughout and pairs with the copied `globals.css`. Both files travel together or neither works — which is what Step 8 verifies.

- [ ] **Step 6: Create `packages/config/eslint/index.js`**

```js
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  { ignores: ['dist/**', '.next/**', 'archive/**', 'node_modules/**'] },
);
```

- [ ] **Step 7: Install eslint dependencies at the root**

```bash
pnpm add -Dw eslint typescript-eslint
```

- [ ] **Step 8: Verify the copied CSS variables and theme tokens line up**

Run: `grep -c -- '--' packages/config/tailwind/globals.css`
Expected: a non-zero count. Then confirm every `var(--x)` referenced in `preset.ts` has a matching `--x:` declaration in `globals.css`. Any token in the preset with no CSS variable renders as a broken colour at runtime and will not be caught by type-check.

- [ ] **Step 9: Commit**

```bash
git add packages/config
git commit -m "feat(config): shared tsconfig, eslint, and salvaged tailwind theme"
```

---

## Task 3: `packages/shared` — the Money primitive

This is real domain logic and the spec requires **100% coverage** on it (§13). It is built test-first.

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/money.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/money.test.ts`

**Interfaces:**
- Consumes: `@nexmarket/config/tsconfig/node.json`.
- Produces: package `@nexmarket/shared` exporting
  - `type Money = { readonly amount: number; readonly currency: string }`
  - `money(amount: number, currency: string): Money`
  - `add(a: Money, b: Money): Money`
  - `subtract(a: Money, b: Money): Money`
  - `multiply(m: Money, factor: number): Money`
  - `allocate(m: Money, ratios: readonly number[]): Money[]`
  - `isZero(m: Money): boolean`
  - `compare(a: Money, b: Money): -1 | 0 | 1`
  - `formatMinor(m: Money): string`
  - `class CurrencyMismatchError extends Error`

`allocate` matters more than it looks: it is how a multi-seller order splits one payment across sellers without losing a paisa, and Phase 4's ledger depends on it summing exactly.

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p packages/shared/src
pnpm --filter @nexmarket/shared add -D vitest @vitest/coverage-v8
```

Create `packages/shared/package.json`:

```json
{
  "name": "@nexmarket/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -b",
    "type-check": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run --coverage"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "@nexmarket/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "composite": true },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/money.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shared/src/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  allocate,
  compare,
  formatMinor,
  isZero,
  money,
  multiply,
  subtract,
} from './money.js';

describe('money', () => {
  it('constructs from integer minor units', () => {
    expect(money(38500, 'BDT')).toEqual({ amount: 38500, currency: 'BDT' });
  });

  it('rejects a non-integer amount', () => {
    expect(() => money(38.5, 'BDT')).toThrow(/integer minor units/);
  });

  it('rejects a currency that is not a 3-letter uppercase code', () => {
    expect(() => money(100, 'bdt')).toThrow(/currency/);
    expect(() => money(100, 'TAKA')).toThrow(/currency/);
  });

  it('allows a negative amount, because refunds and credits exist', () => {
    expect(money(-500, 'BDT').amount).toBe(-500);
  });
});

describe('add and subtract', () => {
  it('adds two amounts in the same currency', () => {
    expect(add(money(100, 'BDT'), money(250, 'BDT'))).toEqual(money(350, 'BDT'));
  });

  it('subtracts two amounts in the same currency', () => {
    expect(subtract(money(250, 'BDT'), money(100, 'BDT'))).toEqual(money(150, 'BDT'));
  });

  it('throws CurrencyMismatchError across currencies', () => {
    expect(() => add(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });
});

describe('multiply', () => {
  it('multiplies by an integer exactly', () => {
    expect(multiply(money(199, 'BDT'), 3)).toEqual(money(597, 'BDT'));
  });

  it('rounds half away from zero on a fractional factor', () => {
    // 199 * 0.5 = 99.5 -> 100
    expect(multiply(money(199, 'BDT'), 0.5)).toEqual(money(100, 'BDT'));
    // -199 * 0.5 = -99.5 -> -100
    expect(multiply(money(-199, 'BDT'), 0.5)).toEqual(money(-100, 'BDT'));
  });

  it('rejects a non-finite factor', () => {
    expect(() => multiply(money(100, 'BDT'), Number.NaN)).toThrow(/finite/);
  });
});

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    const parts = allocate(money(900, 'BDT'), [1, 1, 1]);
    expect(parts).toEqual([money(300, 'BDT'), money(300, 'BDT'), money(300, 'BDT')]);
  });

  it('distributes the remainder to the earliest parts, losing nothing', () => {
    // The canonical case: 5 paisa across 3 ways is 2 + 2 + 1, not 1.67 each.
    const parts = allocate(money(5, 'BDT'), [1, 1, 1]);
    expect(parts).toEqual([money(2, 'BDT'), money(2, 'BDT'), money(1, 'BDT')]);
  });

  it('respects weighted ratios', () => {
    const parts = allocate(money(1000, 'BDT'), [3, 7]);
    expect(parts).toEqual([money(300, 'BDT'), money(700, 'BDT')]);
  });

  it('always sums back to the original amount', () => {
    for (const total of [1, 7, 99, 100, 12345, 999999]) {
      const parts = allocate(money(total, 'BDT'), [5, 3, 2, 1]);
      const sum = parts.reduce((acc, p) => acc + p.amount, 0);
      expect(sum).toBe(total);
    }
  });

  it('handles a negative total, so refunds split the same way', () => {
    const parts = allocate(money(-5, 'BDT'), [1, 1, 1]);
    expect(parts.reduce((acc, p) => acc + p.amount, 0)).toBe(-5);
  });

  it('rejects an empty ratio list', () => {
    expect(() => allocate(money(100, 'BDT'), [])).toThrow(/at least one/);
  });

  it('rejects a negative ratio', () => {
    expect(() => allocate(money(100, 'BDT'), [1, -1])).toThrow(/negative/);
  });

  it('rejects ratios that sum to zero', () => {
    expect(() => allocate(money(100, 'BDT'), [0, 0])).toThrow(/sum to zero/);
  });
});

describe('helpers', () => {
  it('detects zero', () => {
    expect(isZero(money(0, 'BDT'))).toBe(true);
    expect(isZero(money(1, 'BDT'))).toBe(false);
  });

  it('compares within a currency', () => {
    expect(compare(money(100, 'BDT'), money(200, 'BDT'))).toBe(-1);
    expect(compare(money(200, 'BDT'), money(100, 'BDT'))).toBe(1);
    expect(compare(money(100, 'BDT'), money(100, 'BDT'))).toBe(0);
  });

  it('throws when comparing across currencies', () => {
    expect(() => compare(money(100, 'BDT'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('formats as minor units with the currency code', () => {
    expect(formatMinor(money(38500, 'BDT'))).toBe('38500 BDT');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @nexmarket/shared test`
Expected: FAIL — `Failed to resolve import "./money.js"`.

- [ ] **Step 4: Write the implementation**

Create `packages/shared/src/money.ts`:

```ts
/**
 * Money is always integer minor units (paisa, cents) plus an explicit currency.
 * PRD section 8.4: no floats in any pricing, tax, discount, shipping or ledger path.
 * The legacy server did `parseInt(price * 100)`, which is the bug this module exists to make impossible.
 */
export type Money = {
  readonly amount: number;
  readonly currency: string;
};

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Money.amount must be integer minor units, received ${amount}`);
  }
  if (!CURRENCY_RE.test(currency)) {
    throw new RangeError(`Money.currency must be a 3-letter uppercase ISO code, received ${currency}`);
  }
  return { amount, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/** Rounds half away from zero, so -99.5 becomes -100 and 99.5 becomes 100. */
export function multiply(m: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Multiplication factor must be finite, received ${factor}`);
  }
  const raw = m.amount * factor;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, m.currency);
}

/**
 * Splits an amount across weighted parts with no loss.
 * Every minor unit in the input appears in exactly one output part.
 * This is how one buyer payment splits across several sellers in a multi-seller order.
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) {
    throw new RangeError('allocate requires at least one ratio');
  }
  for (const r of ratios) {
    if (!Number.isFinite(r) || r < 0) {
      throw new RangeError(`allocate ratios must be finite and non-negative, received ${r}`);
    }
  }
  const total = ratios.reduce((acc, r) => acc + r, 0);
  if (total === 0) {
    throw new RangeError('allocate ratios must not sum to zero');
  }

  const sign = m.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(m.amount);

  const shares: number[] = [];
  let allocated = 0;
  for (const r of ratios) {
    const share = Math.floor((magnitude * r) / total);
    shares.push(share);
    allocated += share;
  }

  // Hand the rounding remainder out one unit at a time, earliest part first.
  let remainder = magnitude - allocated;
  for (let i = 0; remainder > 0; i = (i + 1) % shares.length) {
    shares[i] = (shares[i] ?? 0) + 1;
    remainder -= 1;
  }

  return shares.map((s) => money(sign * s, m.currency));
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

/** Debug and ledger-audit rendering. User-facing formatting is a Phase 12 i18n concern. */
export function formatMinor(m: Money): string {
  return `${m.amount} ${m.currency}`;
}
```

Create `packages/shared/src/index.ts`:

```ts
export * from './money.js';
```

- [ ] **Step 5: Run the tests to verify they pass at 100% coverage**

Run: `pnpm --filter @nexmarket/shared test`
Expected: PASS, all tests green, and the coverage table shows 100% on `src/money.ts` for lines, functions, branches, and statements. If any threshold is under 100 the run fails — add the missing test rather than lowering the threshold.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Money primitive in integer minor units with lossless allocate"
```

---

## Task 4: Docker Compose and environment contract

**Files:**
- Create: `docker-compose.yml`, `.env.example`
- Modify: root `package.json` (no change needed — `docker:up` was added in Task 1)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a Postgres 16 instance on `localhost:5432` reachable as `postgres://nexmarket_app:nexmarket_dev_password@localhost:5432/nexmarket` and a Redis 7 instance on `localhost:6379`. Later tasks assume the env var names defined in `.env.example`.

The Postgres container bootstraps **two roles**: the superuser `postgres` for migrations, and `nexmarket_app`, a non-superuser role without `BYPASSRLS` that the application connects as. This split is the whole point — see Task 7.

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: nexmarket-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: nexmarket
    ports:
      - '5432:5432'
    volumes:
      - nexmarket-pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d nexmarket']
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: nexmarket-redis
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - nexmarket-redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  nexmarket-pgdata:
  nexmarket-redisdata:
```

- [ ] **Step 2: Create the init script that provisions the application role**

Create `docker/postgres-init/01-app-role.sql`:

```sql
-- The application connects as nexmarket_app, never as the superuser.
-- A superuser and any role with BYPASSRLS silently ignores every RLS policy,
-- which makes tenant isolation look correct in tests while enforcing nothing.
CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'nexmarket_dev_password' NOBYPASSRLS;

GRANT CONNECT ON DATABASE nexmarket TO nexmarket_app;
GRANT USAGE ON SCHEMA public TO nexmarket_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexmarket_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexmarket_app;

-- Everything created later by the migration role is granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexmarket_app;
```

- [ ] **Step 3: Create `.env.example`**

```bash
# ---------------------------------------------------------------------------
# NexMarket - environment contract
# Copy to .env and adjust. Every variable here is validated at startup by zod;
# a missing or malformed value fails the boot rather than surfacing at runtime.
# ---------------------------------------------------------------------------

NODE_ENV=development

# --- Database ---------------------------------------------------------------
# The APPLICATION connects as nexmarket_app: a role WITHOUT bypassrls, so RLS
# policies actually apply. See PRD section 6.3 and docs/architecture/0003.
DATABASE_URL=postgres://nexmarket_app:nexmarket_dev_password@localhost:5432/nexmarket

# MIGRATIONS connect as the owner, which needs DDL rights the app role lacks.
# On Neon this is the neondb_owner connection string.
DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:5432/nexmarket

# --- Redis ------------------------------------------------------------------
REDIS_URL=redis://localhost:6379

# --- API --------------------------------------------------------------------
API_PORT=4000
API_HOST=0.0.0.0

# --- Web --------------------------------------------------------------------
NEXT_PUBLIC_APP_URL=http://localhost:3000
API_INTERNAL_URL=http://localhost:4000
```

- [ ] **Step 4: Bring the stack up and verify both services are healthy**

Run: `docker compose up -d && docker compose ps`
Expected: both `nexmarket-postgres` and `nexmarket-redis` report `healthy`.

- [ ] **Step 5: Verify the app role exists and cannot bypass RLS**

Run:
```bash
docker exec nexmarket-postgres psql -U postgres -d nexmarket -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'nexmarket_app';"
```
Expected: one row, `rolsuper = f`, `rolbypassrls = f`. If either is `t`, RLS will not be enforced and Task 7 will produce a false pass.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker/ .env.example
git commit -m "feat(infra): docker compose for postgres and redis with a non-bypassrls app role"
```

---

## Task 5: `packages/db` — client, pool, and the §6.5 driver assertion

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/src/env.ts`, `packages/db/src/client.ts`, `packages/db/src/assert-driver.ts`, `packages/db/src/index.ts`, `packages/db/drizzle.config.ts`
- Test: `packages/db/src/assert-driver.test.ts`

**Interfaces:**
- Consumes: `@nexmarket/config`, the Docker Postgres from Task 4.
- Produces: package `@nexmarket/db` exporting
  - `pool: Pool` (node-postgres)
  - `db: NodePgDatabase<typeof schema>`
  - `assertInteractiveTransactions(pool: Pool): Promise<void>`
  - `class DriverCapabilityError extends Error`
  - `closeDb(): Promise<void>`

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p packages/db/src
pnpm --filter @nexmarket/db add drizzle-orm pg zod
pnpm --filter @nexmarket/db add -D drizzle-kit @types/pg vitest @vitest/coverage-v8 testcontainers @testcontainers/postgresql tsx
```

Create `packages/db/package.json`:

```json
{
  "name": "@nexmarket/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -b",
    "type-check": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate.ts",
    "seed": "tsx src/seed/index.ts"
  }
}
```

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "@nexmarket/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "composite": true },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers pulls and boots a real Postgres; the default 5s is not enough.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
```

- [ ] **Step 2: Write the env module**

Create `packages/db/src/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
});

export type DbEnv = z.infer<typeof schema>;

export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid database environment: ${detail}`);
  }
  return parsed.data;
}
```

- [ ] **Step 3: Write the failing test for the driver assertion**

Create `packages/db/src/assert-driver.test.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverCapabilityError, assertInteractiveTransactions } from './assert-driver.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('assertInteractiveTransactions', () => {
  it('passes against a driver that holds a multi-statement transaction', async () => {
    await expect(assertInteractiveTransactions(pool)).resolves.toBeUndefined();
  });

  it('throws DriverCapabilityError when state does not survive between statements', async () => {
    // Simulates the Neon HTTP driver: every query is independent, so a value
    // set by SET LOCAL in one statement is invisible to the next.
    const statelessPool = {
      connect: async () => ({
        query: async (text: string) => {
          if (text.includes('current_setting')) {
            return { rows: [{ probe: null }] };
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
    } as unknown as Pool;

    await expect(assertInteractiveTransactions(statelessPool)).rejects.toBeInstanceOf(
      DriverCapabilityError,
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @nexmarket/db test`
Expected: FAIL — `Failed to resolve import "./assert-driver.js"`.

- [ ] **Step 5: Write the driver assertion**

Create `packages/db/src/assert-driver.ts`:

```ts
import type { Pool } from 'pg';

export class DriverCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverCapabilityError';
  }
}

/**
 * PRD section 6.5, blocking acceptance criterion.
 *
 * Neon's HTTP driver cannot hold an interactive transaction: each statement is a
 * separate round trip, so transaction-local state set by one statement is gone by
 * the next. Both RLS tenant context (SET LOCAL) and the double-entry ledger require
 * that state to survive. This probe sets a transaction-local setting and reads it
 * back in a SEPARATE statement inside the SAME transaction. A driver that cannot do
 * that returns null and fails the boot here rather than leaking data later.
 */
export async function assertInteractiveTransactions(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.driver_probe', 'ok', true)");
    const result = await client.query<{ probe: string | null }>(
      "SELECT current_setting('app.driver_probe', true) AS probe",
    );
    await client.query('COMMIT');

    const probe = result.rows[0]?.probe ?? null;
    if (probe !== 'ok') {
      throw new DriverCapabilityError(
        'The configured Postgres driver cannot hold an interactive transaction. ' +
          `Expected the transaction-local setting to read back as "ok", got ${JSON.stringify(probe)}. ` +
          'RLS tenant context and the ledger both require multi-statement transactions. ' +
          'Use node-postgres over TCP or the Neon WebSocket Pool, not the Neon HTTP driver. ' +
          'See PRD section 6.5.',
      );
    }
  } catch (error) {
    if (error instanceof DriverCapabilityError) throw error;
    throw new DriverCapabilityError(
      `Driver capability probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    client.release();
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @nexmarket/db test`
Expected: PASS, both cases green.

- [ ] **Step 7: Write the client and Drizzle config**

Create `packages/db/src/client.ts`:

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadDbEnv } from './env.js';
import * as schema from './schema/index.js';

const env = loadDbEnv();

/**
 * node-postgres over TCP. Chosen over the Neon HTTP driver because that driver
 * cannot hold interactive transactions (PRD 6.5). Works identically against local
 * Docker Postgres and against Neon, so no code path differs between the two.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
```

Create `packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
```

Create `packages/db/src/index.ts`:

```ts
export { db, pool, closeDb } from './client.js';
export { assertInteractiveTransactions, DriverCapabilityError } from './assert-driver.js';
export { loadDbEnv, type DbEnv } from './env.js';
export * as schema from './schema/index.js';
```

Note: `src/index.ts` imports `./schema/index.js`, which Task 6 creates. Type-check will fail until then; that is expected and is why Task 6 follows immediately.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): node-postgres client and the interactive-transaction driver assertion"
```

---

## Task 6: `packages/db` — base schema and the migration runner

**Files:**
- Create: `packages/db/src/schema/reference.ts`, `packages/db/src/schema/organisations.ts`, `packages/db/src/schema/rls-probe.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/migrate.ts`
- Create (generated then hand-edited): `packages/db/migrations/0000_*.sql`, `packages/db/migrations/0001_rls_probe_policies.sql`

**Interfaces:**
- Consumes: `packages/db/src/client.ts` from Task 5.
- Produces: Drizzle table objects `countries`, `currencies`, `organisations`, `rlsProbe`, and the `orgStatus` pgEnum. Exports `runMigrations(): Promise<void>`.

Scoping decision D-B applies: this is the tenancy root and shared-reference data only. `users`, `sessions`, and `org_members` are Phase 1.

- [ ] **Step 1: Write the shared-reference schema**

Create `packages/db/src/schema/reference.ts`:

```ts
import { boolean, char, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Shared-reference class (PRD 6.2): no tenant_id, world-readable, no RLS.
 */
export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  dialCode: text('dial_code').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  /** Digits after the decimal point. Money is stored in minor units, so this is display metadata only. */
  minorUnits: integer('minor_units').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
});
```

- [ ] **Step 2: Write the organisations schema**

Create `packages/db/src/schema/organisations.ts`:

```ts
import { char, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { countries, currencies } from './reference.js';

/** PRD 6.6: DRAFT -> PENDING_REVIEW -> ACTIVE <-> SUSPENDED -> CLOSED */
export const orgStatus = pgEnum('org_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);

/**
 * An organisation IS the tenant (PRD 6.1). The row itself is platform-owned and
 * admin-guarded; every tenant-owned table from Phase 1 onward carries
 * `tenant_id uuid NOT NULL REFERENCES organisations(id)` and is RLS-enforced.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  legalName: text('legal_name').notNull(),
  displayName: text('display_name').notNull(),
  status: orgStatus('status').notNull().default('DRAFT'),
  countryCode: char('country_code', { length: 2 })
    .notNull()
    .references(() => countries.code),
  defaultCurrency: char('default_currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  /** Retained by the ETL so a migrated row can be traced to its Mongo original. */
  legacyMongoId: text('legacy_mongo_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Write the RLS probe table**

Create `packages/db/src/schema/rls-probe.ts`:

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

/**
 * Exists solely to prove tenant isolation works before any real data depends on it.
 * It is the smallest possible tenant-owned table: a tenant_id and a payload.
 * Task 7's concurrency test reads and writes it from two tenants over one pool.
 *
 * Phase 1 keeps this table. It is cheap, and a permanently green isolation test that
 * runs against a table with no business meaning is a canary worth having.
 */
export const rlsProbe = pgTable('rls_probe', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Write the schema barrel**

Create `packages/db/src/schema/index.ts`:

```ts
export * from './reference.js';
export * from './organisations.js';
export * from './rls-probe.js';
```

- [ ] **Step 5: Generate the initial migration**

Run: `pnpm --filter @nexmarket/db run generate`
Expected: a file appears at `packages/db/migrations/0000_<generated-name>.sql` containing `CREATE TYPE "org_status"`, `CREATE TABLE "countries"`, `"currencies"`, `"organisations"`, `"rls_probe"`.

Inspect the generated SQL before continuing. Drizzle Kit generates only what the schema expresses; it cannot generate RLS, which is why Step 6 is hand-written.

- [ ] **Step 6: Hand-write the RLS migration**

Create `packages/db/migrations/0001_rls_probe_policies.sql`:

```sql
-- PRD section 6.3. Hand-written because drizzle-kit cannot express RLS.
--
-- FORCE ROW LEVEL SECURITY is not optional. Without it the table OWNER bypasses
-- every policy, which is exactly how a sibling project ended up with 112
-- policy-bearing tables and zero enforcement.

ALTER TABLE "rls_probe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rls_probe" FORCE ROW LEVEL SECURITY;

-- Reads and writes are confined to the tenant in transaction-local context.
-- current_setting(..., true) returns NULL rather than erroring when unset,
-- and NULL = anything is NULL, which is not TRUE, so an unset context
-- yields ZERO rows. That is the required behaviour (PRD 6.4 criterion 4):
-- missing context must fail closed, never open.
CREATE POLICY tenant_isolation ON "rls_probe"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY platform_admin_bypass ON "rls_probe"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

-- The app role must be able to reach tables created by the migration role.
-- This block is deliberately self-contained rather than relying on the Docker init
-- script: the Testcontainers suites in Tasks 7 and 8 run migrations against a fresh
-- container that never sees docker/postgres-init, and Neon is provisioned by hand.
-- Without the schema grant, those tests fail on "permission denied for schema public"
-- and look like an RLS failure when they are nothing of the kind.
GRANT USAGE ON SCHEMA public TO nexmarket_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexmarket_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexmarket_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexmarket_app;
```

Every future migration that creates a tenant-owned table repeats the `ENABLE` / `FORCE` / `CREATE POLICY` trio. Phase 1 factors that into a helper once there are enough tables to justify it; doing it now would abstract over a single case.

Note the `NULLIF(..., '')` wrapper. `withTenant` writes an empty string when `tenantId` is null, and `''::uuid` raises `invalid input syntax for type uuid`. `NULLIF` turns it into NULL so the comparison fails closed instead of throwing.

- [ ] **Step 7: Write the migration runner**

Create `packages/db/src/migrate.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Migrations connect as the OWNER, not as nexmarket_app: they need DDL rights the
 * application role deliberately does not have.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set to run migrations');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runMigrations().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 8: Run the migrations against local Postgres**

Run:
```bash
docker compose up -d
pnpm db:push
```
Expected: `Migrations applied.`

- [ ] **Step 9: Verify RLS is enabled AND forced on the probe table**

Run:
```bash
docker exec nexmarket-postgres psql -U postgres -d nexmarket -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'rls_probe';"
```
Expected: one row with `relrowsecurity = t` and `relforcerowsecurity = t`. If `relforcerowsecurity` is `f`, the owner bypasses the policy and Task 7 will pass for the wrong reason.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): base schema, migration runner, and forced RLS on the probe table"
```

---

## Task 7: `packages/db` — `withTenant` and the isolation proof

The most important task in Phase 0. §13 requires **100% coverage on RLS**.

**Files:**
- Create: `packages/db/src/tenant-context.ts`
- Test: `packages/db/src/tenant-context.test.ts`
- Modify: `packages/db/src/index.ts` (export `withTenant`), `packages/db/vitest.config.ts` (coverage thresholds)

**Interfaces:**
- Consumes: `db` and `pool` from Task 5, `organisations` and `rlsProbe` from Task 6.
- Produces:
  - `type TenantContext = { tenantId: string | null; isAdmin: boolean }`
  - `withTenant<T>(ctx: TenantContext, fn: (tx: Transaction) => Promise<T>): Promise<T>`
  - `type Transaction` (the Drizzle transaction handle passed to `fn`)

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/tenant-context.test.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';
import { makeWithTenant } from './tenant-context.js';

const here = dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let appDb: NodePgDatabase<typeof schema>;
let withTenant: ReturnType<typeof makeWithTenant>;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // Migrate as the owner.
  const ownerPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const ownerDb = drizzle(ownerPool);
  await ownerDb.execute(
    sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`,
  );
  await migrate(ownerDb, { migrationsFolder: join(here, '..', 'migrations') });

  await ownerDb.insert(schema.countries).values({ code: 'BD', name: 'Bangladesh', dialCode: '+880' });
  await ownerDb.insert(schema.currencies).values({ code: 'BDT', name: 'Taka', symbol: 'Tk' });

  const [a] = await ownerDb
    .insert(schema.organisations)
    .values({ slug: 'tenant-a', legalName: 'Tenant A Ltd', displayName: 'Tenant A', countryCode: 'BD', defaultCurrency: 'BDT' })
    .returning({ id: schema.organisations.id });
  const [b] = await ownerDb
    .insert(schema.organisations)
    .values({ slug: 'tenant-b', legalName: 'Tenant B Ltd', displayName: 'Tenant B', countryCode: 'BD', defaultCurrency: 'BDT' })
    .returning({ id: schema.organisations.id });

  if (!a || !b) throw new Error('fixture setup failed');
  tenantA = a.id;
  tenantB = b.id;

  await ownerDb.insert(schema.rlsProbe).values([
    { tenantId: tenantA, payload: 'secret-of-a' },
    { tenantId: tenantB, payload: 'secret-of-b' },
  ]);
  await ownerPool.end();

  // The APP connects as nexmarket_app, which cannot bypass RLS.
  const uri = new URL(container.getConnectionUri());
  uri.username = 'nexmarket_app';
  uri.password = 'probe';
  appPool = new Pool({ connectionString: uri.toString(), max: 5 });
  appDb = drizzle(appPool, { schema });
  withTenant = makeWithTenant(appDb);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await container?.stop();
});

describe('the connecting role', () => {
  it('cannot bypass RLS, or every other test here is meaningless', async () => {
    const res = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0]?.rolsuper).toBe(false);
    expect(res.rows[0]?.rolbypassrls).toBe(false);
  });
});

describe('withTenant', () => {
  it('sees only its own tenant rows', async () => {
    const rows = await withTenant({ tenantId: tenantA, isAdmin: false }, async (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe('secret-of-a');
  });

  it('returns ZERO rows when tenant context is omitted, never all rows', async () => {
    // PRD 6.4 acceptance criterion 4. Failing open here is a breach, not a bug.
    const rows = await withTenant({ tenantId: null, isAdmin: false }, async (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(0);
  });

  it('lets a platform admin see across tenants', async () => {
    const rows = await withTenant({ tenantId: null, isAdmin: true }, async (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses a write attributed to another tenant', async () => {
    await expect(
      withTenant({ tenantId: tenantA, isAdmin: false }, async (tx) =>
        tx.insert(schema.rlsProbe).values({ tenantId: tenantB, payload: 'forged' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not leak context to the next transaction on the same connection', async () => {
    // The pooling hazard itself (PRD 6.4). Force a single connection so the second
    // transaction is guaranteed to reuse the physical connection the first used.
    const singlePool = new Pool({ connectionString: appPool.options.connectionString, max: 1 });
    const singleDb = drizzle(singlePool, { schema });
    const single = makeWithTenant(singleDb);
    try {
      await single({ tenantId: tenantA, isAdmin: false }, async (tx) =>
        tx.select().from(schema.rlsProbe),
      );
      const leaked = await singleDb.execute<{ v: string | null }>(
        sql`SELECT current_setting('app.tenant_id', true) AS v`,
      );
      const value = leaked.rows[0]?.v ?? null;
      expect(value === null || value === '').toBe(true);
    } finally {
      await singlePool.end();
    }
  });

  it('keeps two tenants isolated under interleaved concurrent load', async () => {
    // PRD 6.4 acceptance criterion 3, and success criterion S1.
    const work = Array.from({ length: 40 }, (_, i) => {
      const tenant = i % 2 === 0 ? tenantA : tenantB;
      const expected = i % 2 === 0 ? 'secret-of-a' : 'secret-of-b';
      return withTenant({ tenantId: tenant, isAdmin: false }, async (tx) => {
        const rows = await tx.select().from(schema.rlsProbe);
        return { rows, expected };
      });
    });

    const results = await Promise.all(work);
    for (const { rows, expected } of results) {
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toBe(expected);
    }
  });

  it('rolls back and does not swallow an error from the callback', async () => {
    await expect(
      withTenant({ tenantId: tenantA, isAdmin: false }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @nexmarket/db test`
Expected: FAIL — `Failed to resolve import "./tenant-context.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/tenant-context.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from './client.js';
import type * as schema from './schema/index.js';

export type TenantContext = {
  readonly tenantId: string | null;
  readonly isAdmin: boolean;
};

type Db = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * PRD section 6.4 - MANDATORY IMPLEMENTATION RULE.
 *
 * Tenant context is set with set_config(..., true). The third argument `true` means
 * `is_local`, which is exactly SET LOCAL: the value is scoped to THIS transaction and
 * is discarded at COMMIT or ROLLBACK.
 *
 * A plain `SET` would persist on the physical connection after the request ends. The
 * pooler hands that connection to the next request, possibly for a different tenant,
 * which then inherits the previous tenant's context. That is a cross-tenant read. It
 * does not appear in single-user testing and stays invisible until concurrent load.
 *
 * NEVER replace set_config(..., true) with a plain SET, and never set tenant context
 * outside a transaction.
 */
export function makeWithTenant(database: Db) {
  return async function withTenant<T>(
    ctx: TenantContext,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return database.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true)`);
      await tx.execute(sql`SELECT set_config('app.is_admin', ${String(ctx.isAdmin)}, true)`);
      return fn(tx);
    });
  };
}

export const withTenant = makeWithTenant(defaultDb);
```

`makeWithTenant` exists so tests can bind a throwaway Testcontainers database without importing the module-level singleton, which reads `DATABASE_URL` at import time.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @nexmarket/db test`
Expected: PASS. All eight assertions green, including the concurrency test and the leak test.

If `refuses a write attributed to another tenant` passes but `sees only its own tenant rows` returns 2 rows, the connecting role is bypassing RLS — re-check Task 4 Step 5 and Task 6 Step 9.

- [ ] **Step 5: Add the RLS coverage threshold**

Modify `packages/db/vitest.config.ts` to add coverage:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/tenant-context.ts', 'src/assert-driver.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
```

- [ ] **Step 6: Export `withTenant` and forbid raw `db` imports outside `packages/db`**

Modify `packages/db/src/index.ts`, adding:

```ts
export { withTenant, makeWithTenant, type TenantContext, type Transaction } from './tenant-context.js';
```

Add to `packages/config/eslint/index.js` inside the `rules` object of the main config block:

```js
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@nexmarket/db',
          importNames: ['db', 'pool'],
          message: 'Import withTenant instead. Raw db bypasses RLS tenant context. See PRD 6.4 criterion 2.',
        }],
      }],
```

This is §6.4 acceptance criterion 2. It is written now, in Phase 0, because a rule added after the first violation is a rule that gets suppressed.

- [ ] **Step 7: Run the full db test suite with coverage**

Run: `pnpm --filter @nexmarket/db test -- --coverage`
Expected: PASS at 100% on `tenant-context.ts` and `assert-driver.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/db packages/config
git commit -m "feat(db): withTenant with transaction-local context and a concurrent isolation proof"
```

---

## Task 8: `packages/db` — the seed harness

**Files:**
- Create: `packages/db/src/seed/index.ts`, `packages/db/src/seed/reference-data.ts`, `packages/db/src/seed/organisations.ts`
- Test: `packages/db/src/seed/seed.test.ts`

**Interfaces:**
- Consumes: schema from Task 6, migration runner from Task 6.
- Produces: `pnpm seed` at the repo root. Exports `seed(db: Db): Promise<SeedSummary>` where `type SeedSummary = { countries: number; currencies: number; organisations: number }`.

Phase 0 seeds only what Phase 0's schema holds. S5 (8 orgs, 500 products, 200 orders, 300 reviews) is met incrementally as each phase adds its tables; Phase 0 delivers the 8 seller organisations and the reference data, and the harness they plug into.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/seed/seed.test.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { seed } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
  db = drizzle(pool, { schema });
  await db.execute(sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(drizzle(pool), { migrationsFolder: join(here, '..', '..', 'migrations') });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('seed', () => {
  it('creates reference data and 8 seller organisations', async () => {
    const summary = await seed(db);
    expect(summary.organisations).toBe(8);
    expect(summary.currencies).toBeGreaterThanOrEqual(2);
    expect(summary.countries).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent, so running it twice does not duplicate or throw', async () => {
    // S4 requires `pnpm seed` to be safe to re-run on a machine that already has data.
    const second = await seed(db);
    expect(second.organisations).toBe(8);

    const orgs = await db.select().from(schema.organisations);
    expect(orgs).toHaveLength(8);
  });

  it('gives every seeded organisation an ACTIVE status and a valid currency', async () => {
    const orgs = await db.select().from(schema.organisations);
    for (const org of orgs) {
      expect(org.status).toBe('ACTIVE');
      expect(org.defaultCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nexmarket/db test seed`
Expected: FAIL — `Failed to resolve import "./index.js"` from the seed directory.

- [ ] **Step 3: Write the reference data seeder**

Create `packages/db/src/seed/reference-data.ts`:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

const COUNTRIES = [
  { code: 'BD', name: 'Bangladesh', dialCode: '+880' },
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
] as const;

const CURRENCIES = [
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: 'Tk', minorUnits: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: 'GBP', minorUnits: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnits: 2 },
] as const;

export async function seedReferenceData(db: Db): Promise<{ countries: number; currencies: number }> {
  await db.insert(schema.countries).values([...COUNTRIES]).onConflictDoNothing();
  await db.insert(schema.currencies).values([...CURRENCIES]).onConflictDoNothing();
  return { countries: COUNTRIES.length, currencies: CURRENCIES.length };
}
```

- [ ] **Step 4: Write the organisations seeder**

Create `packages/db/src/seed/organisations.ts`:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Eight seller organisations across distinct verticals, per success criterion S5.
 * Deliberately generic: this is a universal marketplace, not a vertical one.
 */
const ORGS = [
  { slug: 'acme-electronics', legalName: 'Acme Electronics Ltd', displayName: 'Acme Electronics', countryCode: 'BD', defaultCurrency: 'BDT' },
  { slug: 'meridian-fashion', legalName: 'Meridian Fashion House Ltd', displayName: 'Meridian Fashion', countryCode: 'BD', defaultCurrency: 'BDT' },
  { slug: 'northwind-home', legalName: 'Northwind Home and Living Ltd', displayName: 'Northwind Home', countryCode: 'BD', defaultCurrency: 'BDT' },
  { slug: 'olympus-sports', legalName: 'Olympus Sporting Goods Ltd', displayName: 'Olympus Sports', countryCode: 'IN', defaultCurrency: 'INR' },
  { slug: 'lumen-books', legalName: 'Lumen Books and Media Ltd', displayName: 'Lumen Books', countryCode: 'IN', defaultCurrency: 'INR' },
  { slug: 'verdant-grocers', legalName: 'Verdant Grocers Ltd', displayName: 'Verdant Grocers', countryCode: 'BD', defaultCurrency: 'BDT' },
  { slug: 'atlas-auto-parts', legalName: 'Atlas Auto Parts LLC', displayName: 'Atlas Auto Parts', countryCode: 'AE', defaultCurrency: 'AED' },
  { slug: 'cobalt-beauty', legalName: 'Cobalt Beauty Inc', displayName: 'Cobalt Beauty', countryCode: 'US', defaultCurrency: 'USD' },
] as const;

export async function seedOrganisations(db: Db): Promise<number> {
  await db
    .insert(schema.organisations)
    .values(ORGS.map((o) => ({ ...o, status: 'ACTIVE' as const })))
    .onConflictDoNothing({ target: schema.organisations.slug });
  return ORGS.length;
}
```

- [ ] **Step 5: Write the seed entry point**

Create `packages/db/src/seed/index.ts`:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema/index.js';
import { seedOrganisations } from './organisations.js';
import { seedReferenceData } from './reference-data.js';

type Db = NodePgDatabase<typeof schema>;

export type SeedSummary = {
  countries: number;
  currencies: number;
  organisations: number;
};

/**
 * Idempotent by construction: every insert uses onConflictDoNothing, so `pnpm seed`
 * is safe to re-run. Later phases append their own seeders here in dependency order.
 */
export async function seed(db: Db): Promise<SeedSummary> {
  const reference = await seedReferenceData(db);
  const organisations = await seedOrganisations(db);
  return { ...reference, organisations };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { db, closeDb } = await import('../client.js');
  try {
    const summary = await seed(db);
    console.log('Seeded:', summary);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @nexmarket/db test seed`
Expected: PASS, all three cases green including idempotency.

- [ ] **Step 7: Run the seed against local Postgres end to end**

Run:
```bash
pnpm db:push && pnpm seed && pnpm seed
```
Expected: `Seeded: { countries: 5, currencies: 5, organisations: 8 }` printed twice with no error. Running it a second time proving idempotent is the point of the second invocation.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): idempotent seed harness with reference data and 8 seller orgs"
```

---

## Task 9: `apps/api` — NestJS on Fastify with the startup assertion wired

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/env.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.module.ts`
- Test: `apps/api/test/health.e2e.test.ts`

**Interfaces:**
- Consumes: `@nexmarket/db` (`pool`, `assertInteractiveTransactions`), `@nexmarket/config`.
- Produces: an API on `http://localhost:4000` with `GET /health` returning `{ status: 'ok', database: 'ok' }` and OpenAPI JSON at `/docs-json`.

- [ ] **Step 1: Scaffold the app**

```bash
mkdir -p apps/api/src/health apps/api/test
pnpm --filter @nexmarket/api add @nestjs/common @nestjs/core @nestjs/platform-fastify @nestjs/swagger @nestjs/config zod
pnpm --filter @nexmarket/api add @nexmarket/db@workspace:* @nexmarket/shared@workspace:* @nexmarket/config@workspace:*
pnpm --filter @nexmarket/api add -D @nestjs/cli @nestjs/testing typescript vitest supertest @types/supertest tsx
```

Create `apps/api/package.json`:

```json
{
  "name": "@nexmarket/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "type-check": "tsc --noEmit",
    "lint": "eslint src test",
    "test": "vitest run"
  }
}
```

Create `apps/api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "@nexmarket/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

NestJS needs CommonJS and decorator metadata, which is why this deviates from the node preset.

- [ ] **Step 2: Write the env module**

Create `apps/api/src/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
});

export type ApiEnv = z.infer<typeof schema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API environment: ${detail}`);
  }
  return parsed.data;
}
```

- [ ] **Step 3: Write the failing health test**

Create `apps/api/test/health.e2e.test.ts`:

```ts
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /health', () => {
  it('reports the service and the database as ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @nexmarket/api test`
Expected: FAIL — cannot resolve `../src/app.module.js`.

- [ ] **Step 5: Write the health module**

Create `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { pool } from '@nexmarket/db';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'Service and database liveness.' })
  async check(): Promise<{ status: string; database: string }> {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unreachable' };
    }
  }
}
```

This controller is the one sanctioned place that imports `pool` directly — it checks connectivity, not tenant data. Add an inline `// eslint-disable-next-line no-restricted-imports` above the import with a comment explaining why, so the Task 7 lint rule stays meaningful.

Create `apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

Create `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [HealthModule] })
export class AppModule {}
```

- [ ] **Step 6: Write `main.ts` with the driver assertion before the port opens**

Create `apps/api/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { assertInteractiveTransactions, pool } from '@nexmarket/db';
import { AppModule } from './app.module.js';
import { loadApiEnv } from './env.js';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();

  // PRD 6.5 blocking acceptance criterion. This runs BEFORE the port opens, so a
  // driver that cannot hold interactive transactions fails the boot instead of
  // serving requests whose RLS context silently does nothing.
  await assertInteractiveTransactions(pool);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  const config = new DocumentBuilder()
    .setTitle('NexMarket API')
    .setDescription('Universal multi-tenant marketplace')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  });

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  console.log(`API listening on http://localhost:${env.API_PORT} (docs at /docs)`);
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `docker compose up -d && pnpm --filter @nexmarket/api test`
Expected: PASS.

- [ ] **Step 8: Verify the startup assertion actually blocks a bad driver**

Run:
```bash
DATABASE_URL=postgres://nexmarket_app:nexmarket_dev_password@localhost:9999/nexmarket pnpm --filter @nexmarket/api run build && DATABASE_URL=postgres://nexmarket_app:nexmarket_dev_password@localhost:9999/nexmarket node apps/api/dist/main.js
```
Expected: the process exits non-zero with `Driver capability probe failed`, and no port is opened. This proves the assertion is on the boot path rather than decorative.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): NestJS on Fastify with health, OpenAPI, and the boot-time driver assertion"
```

---

## Task 10: `apps/web` — Next.js 15 with the salvaged shadcn primitives

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/components.json`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/web/lib/utils.ts`
- Copy: 32 files from `archive/frontend/components/ui/` to `apps/web/components/ui/`

**Interfaces:**
- Consumes: `@nexmarket/config/tailwind/preset`, `@nexmarket/config/tailwind/globals.css`.
- Produces: a Next.js app on `http://localhost:3000` that builds clean.

§12.1 governs what is salvaged. **Nothing else** comes across: no pages, no `lib/api/*`, no Zustand stores, no `lib/mock-data/`, no `lib/firebase/`, no `components/pages/home/*`.

- [ ] **Step 1: Scaffold the app**

```bash
mkdir -p apps/web/app apps/web/components/ui apps/web/lib
pnpm --filter @nexmarket/web add next react react-dom clsx tailwind-merge class-variance-authority lucide-react
pnpm --filter @nexmarket/web add @nexmarket/config@workspace:* @nexmarket/shared@workspace:*
pnpm --filter @nexmarket/web add -D typescript @types/react @types/react-dom @types/node tailwindcss postcss autoprefixer tailwindcss-animate
```

Radix packages are added per primitive in Step 3, after the copy shows which are actually referenced.

Create `apps/web/package.json`:

```json
{
  "name": "@nexmarket/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "next build",
    "dev": "next dev --port 3000",
    "start": "next start",
    "type-check": "tsc --noEmit",
    "lint": "eslint app components lib",
    "test": "echo 'no web unit tests in phase 0'"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "@nexmarket/config/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Copy the 32 salvaged primitives, excluding the duplicate**

```bash
cp archive/frontend/components/ui/*.tsx apps/web/components/ui/
rm apps/web/components/ui/product-card-enhanced.tsx
cp archive/frontend/lib/utils.ts apps/web/lib/utils.ts
ls apps/web/components/ui | wc -l
```

Expected: `32`. §12.1 names `product-card-enhanced.tsx` as a duplicate whose non-enhanced twin is the wired one, so it is dropped.

- [ ] **Step 3: Install exactly the Radix packages the copied primitives import**

```bash
grep -rho '@radix-ui/[a-z-]*' apps/web/components/ui | sort -u
```

Install each package the grep reports, plus the non-Radix runtime imports the primitives use. Based on the archived `package.json` these are `react-day-picker`, `embla-carousel-react`, `react-hook-form`, `@hookform/resolvers`, and `date-fns`; confirm against the grep rather than assuming, because the archived manifest also lists packages only the deleted pages used.

```bash
pnpm --filter @nexmarket/web add <every package the grep reported>
```

- [ ] **Step 4: Wire Tailwind to the shared preset**

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';
import preset from '@nexmarket/config/tailwind/preset';

export default {
  presets: [preset],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

Create `apps/web/postcss.config.mjs`:

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

Create `apps/web/app/globals.css`:

```css
@import '@nexmarket/config/tailwind/globals.css';
```

- [ ] **Step 5: Create `components.json` with the `hooks` alias FIXED**

The archived `components.json` points `hooks` at `@/lib/hooks`, a directory that does not exist. §12.1 requires the corrected version:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Create the directory so the alias resolves: `mkdir -p apps/web/hooks && touch apps/web/hooks/.gitkeep`

- [ ] **Step 6: Write the root layout and a placeholder page**

Create `apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NexMarket',
  description: 'A universal multi-tenant marketplace',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
```

Create `apps/web/app/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';

/**
 * Server component by default. The storefront arrives in Phase 2; this page exists
 * to prove the build, the Tailwind preset, and the salvaged primitives all work.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">NexMarket</h1>
      <p className="text-muted-foreground">
        Phase 0 foundation. The storefront lands in Phase 2.
      </p>
      <div>
        <Button>Primitives are wired</Button>
      </div>
    </main>
  );
}
```

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@nexmarket/shared'],
};

export default config;
```

- [ ] **Step 7: Verify the build succeeds**

Run: `pnpm --filter @nexmarket/web run build`
Expected: `Compiled successfully`. If any primitive fails to resolve an import, install the missing package — do not delete the primitive.

This is the step the previous rewrite never reached. The archived `frontend/` had two pages resolving to `/` and had never been built because `node_modules` was never installed.

- [ ] **Step 8: Verify the dev server renders**

Run: `pnpm --filter @nexmarket/web run dev`
Expected: `http://localhost:3000` renders the heading and a styled button. A visibly unstyled button means the Tailwind preset and `globals.css` tokens are out of sync — revisit Task 2 Step 8.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): Next.js 15 app with 32 salvaged shadcn primitives and the shared theme"
```

---

## Task 11: `apps/worker` — BullMQ consumer skeleton

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/env.ts`, `apps/worker/src/queues.ts`, `apps/worker/src/main.ts`
- Test: `apps/worker/src/queues.test.ts`

**Interfaces:**
- Consumes: Redis from Task 4.
- Produces: `QUEUE_NAMES` (a readonly tuple), `createWorker(name, handler)`, and a process that connects to Redis and shuts down cleanly on SIGTERM.

- [ ] **Step 1: Scaffold**

```bash
mkdir -p apps/worker/src
pnpm --filter @nexmarket/worker add bullmq ioredis zod
pnpm --filter @nexmarket/worker add -D vitest tsx typescript
```

Create `apps/worker/package.json`:

```json
{
  "name": "@nexmarket/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/main.js",
    "type-check": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  }
}
```

Create `apps/worker/tsconfig.json`:

```json
{
  "extends": "@nexmarket/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/worker/src/queues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, isQueueName } from './queues.js';

describe('QUEUE_NAMES', () => {
  it('declares the phase-0 queue set', () => {
    expect(QUEUE_NAMES).toContain('email');
    expect(QUEUE_NAMES).toContain('import');
    expect(QUEUE_NAMES).toContain('reindex');
    expect(QUEUE_NAMES).toContain('settlement');
  });

  it('has no duplicates, because two workers on one name silently split jobs', () => {
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
  });

  it('narrows an arbitrary string to a queue name', () => {
    expect(isQueueName('email')).toBe(true);
    expect(isQueueName('not-a-queue')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @nexmarket/worker test`
Expected: FAIL — cannot resolve `./queues.js`.

- [ ] **Step 4: Write the queue registry**

Create `apps/worker/src/queues.ts`:

```ts
/** PRD 7.1: jobs are email, import, reindex, settlement. Handlers arrive per phase. */
export const QUEUE_NAMES = ['email', 'import', 'reindex', 'settlement'] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(value);
}
```

Create `apps/worker/src/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  REDIS_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid worker environment: ${detail}`);
  }
  return parsed.data;
}
```

- [ ] **Step 5: Write the worker bootstrap**

Create `apps/worker/src/main.ts`:

```ts
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadWorkerEnv } from './env.js';
import { QUEUE_NAMES } from './queues.js';

const env = loadWorkerEnv();

// BullMQ requires maxRetriesPerRequest to be null on the blocking connection.
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        // Phase 0 registers the queues and proves the connection. Each later phase
        // replaces this with its real handler.
        console.log(`[${name}] received job ${job.id} (no handler registered yet)`);
      },
      { connection, concurrency: 5 },
    ),
);

console.log(`Worker online. Queues: ${QUEUE_NAMES.join(', ')}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, draining workers.`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @nexmarket/worker test`
Expected: PASS.

- [ ] **Step 7: Verify the worker connects to Redis**

Run: `docker compose up -d && pnpm --filter @nexmarket/worker run dev`
Expected: `Worker online. Queues: email, import, reindex, settlement`. Ctrl-C prints the drain message and exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): BullMQ consumer skeleton with typed queue registry"
```

---

## Task 12: `scripts/mongo-etl` — the ETL skeleton

**Files:**
- Create: `scripts/mongo-etl/package.json`, `scripts/mongo-etl/tsconfig.json`, `scripts/mongo-etl/src/types.ts`, `scripts/mongo-etl/src/extract.ts`, `scripts/mongo-etl/src/transform.ts`, `scripts/mongo-etl/src/verify.ts`, `scripts/mongo-etl/src/main.ts`, `scripts/mongo-etl/README.md`
- Test: `scripts/mongo-etl/src/transform.test.ts`

**Interfaces:**
- Consumes: `@nexmarket/shared` (money helpers).
- Produces: `extract`, `transform`, `verify` functions and a CLI. Phase 0 delivers the skeleton plus the transform functions that need no database; the load stage is stubbed and lands with the schema it targets.

§12.1 names four hazards; the transform tests below cover the three that are pure functions. The fourth (orphaned `cartIds`) needs the load stage.

- [ ] **Step 1: Scaffold**

```bash
mkdir -p scripts/mongo-etl/src
pnpm --filter @nexmarket/mongo-etl add mongodb zod
pnpm --filter @nexmarket/mongo-etl add @nexmarket/shared@workspace:*
pnpm --filter @nexmarket/mongo-etl add -D vitest tsx typescript
```

Create `scripts/mongo-etl/package.json`:

```json
{
  "name": "@nexmarket/mongo-etl",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "type-check": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "etl": "tsx src/main.ts"
  }
}
```

- [ ] **Step 2: Write the typed Mongo shapes**

Create `scripts/mongo-etl/src/types.ts`. The eight collections are confirmed from `archive/old-code/server-side/index.js`: `user`, `products`, `category`, `cart`, `ads`, `approvedAds`, `payments`, `invoice`.

```ts
export const MONGO_COLLECTIONS = [
  'user',
  'products',
  'category',
  'cart',
  'ads',
  'approvedAds',
  'payments',
  'invoice',
] as const;

export type MongoCollection = (typeof MONGO_COLLECTIONS)[number];

export type LegacyUser = {
  _id: string;
  email: string;
  name?: string;
  role?: string;
  photoURL?: string;
};

export type LegacyProduct = {
  _id: string;
  itemName: string;
  email: string;
  category?: string;
  price?: number;
  quantity?: number;
  description?: string;
  image?: string;
};

export type LegacyCartItem = {
  _id: string;
  email: string;
  productId?: string;
  quantity?: number;
};

export type LegacyPayment = {
  _id: string;
  email: string;
  price?: number;
  transactionId?: string;
  date?: string;
  cartIds?: string[];
  status?: string;
};

export type ExtractReport = {
  collection: MongoCollection;
  documentCount: number;
};

export type QuarantinedRow = {
  collection: MongoCollection;
  id: string;
  reason: string;
};
```

- [ ] **Step 3: Write the failing transform tests**

Create `scripts/mongo-etl/src/transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dedupeAds, isMigratableObjectId, normaliseRole, toMinorUnits } from './transform.js';

describe('toMinorUnits', () => {
  it('converts a float price to integer minor units', () => {
    expect(toMinorUnits(385.0, 'BDT')).toEqual({ amount: 38500, currency: 'BDT' });
  });

  it('rounds half away from zero deterministically', () => {
    // 12.345 * 100 = 1234.5 -> 1235. Documented so the reconciliation report is explainable.
    expect(toMinorUnits(12.345, 'BDT').amount).toBe(1235);
  });

  it('survives binary float representation error', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754. Naive parseInt gives 1998.
    expect(toMinorUnits(19.99, 'USD').amount).toBe(1999);
  });

  it('treats a missing price as zero rather than NaN', () => {
    expect(toMinorUnits(undefined, 'BDT').amount).toBe(0);
  });
});

describe('isMigratableObjectId', () => {
  it('accepts a real 24-hex ObjectId', () => {
    expect(isMigratableObjectId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('rejects the legacy temp- cart id so it is quarantined, not crashed on', () => {
    // Section 12.1 hazard 1.
    expect(isMigratableObjectId('temp-1699999999999')).toBe(false);
  });

  it('rejects an empty or undefined id', () => {
    expect(isMigratableObjectId('')).toBe(false);
    expect(isMigratableObjectId(undefined)).toBe(false);
  });
});

describe('normaliseRole', () => {
  it('maps a known role', () => {
    expect(normaliseRole('admin')).toBe('admin');
    expect(normaliseRole('seller')).toBe('seller');
  });

  it('defaults a missing role to buyer', () => {
    // Section 12.1 hazard 4.
    expect(normaliseRole(undefined)).toBe('buyer');
    expect(normaliseRole('')).toBe('buyer');
  });

  it('defaults an unrecognised role to buyer rather than throwing', () => {
    expect(normaliseRole('wizard')).toBe('buyer');
  });
});

describe('dedupeAds', () => {
  it('collapses a row present in both ads and approvedAds', () => {
    // Section 12.1 hazard 2: approvedAds duplicates rows in ads.
    const merged = dedupeAds(
      [{ _id: 'a1', title: 'Sale' }, { _id: 'a2', title: 'Promo' }],
      [{ _id: 'a1', title: 'Sale' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.filter((a) => a._id === 'a1')).toHaveLength(1);
  });

  it('marks a row that appeared in approvedAds as approved', () => {
    const merged = dedupeAds([{ _id: 'a1', title: 'Sale' }], [{ _id: 'a1', title: 'Sale' }]);
    expect(merged[0]?.status).toBe('APPROVED');
  });

  it('marks a row absent from approvedAds as pending', () => {
    const merged = dedupeAds([{ _id: 'a2', title: 'Promo' }], []);
    expect(merged[0]?.status).toBe('PENDING');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @nexmarket/mongo-etl test`
Expected: FAIL — cannot resolve `./transform.js`.

- [ ] **Step 5: Write the transform module**

Create `scripts/mongo-etl/src/transform.ts`:

```ts
import { money, type Money } from '@nexmarket/shared';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * The legacy server stored prices as floats and did `parseInt(price * 100)`, which
 * truncates: 19.99 becomes 1998 because 19.99 * 100 is 1998.9999999999998 in IEEE 754.
 * We round half away from zero instead, and the verify stage reconciles the totals.
 */
export function toMinorUnits(price: number | undefined, currency: string): Money {
  if (price === undefined || !Number.isFinite(price)) {
    return money(0, currency);
  }
  const raw = price * 100;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, currency);
}

/** Section 12.1 hazard 1: `cart._id` values like `temp-1699999999999` are not ObjectIds. */
export function isMigratableObjectId(id: string | undefined): boolean {
  return typeof id === 'string' && OBJECT_ID_RE.test(id);
}

const KNOWN_ROLES = new Set(['admin', 'seller', 'buyer']);

/** Section 12.1 hazard 4: users with no role default to buyer-only. */
export function normaliseRole(role: string | undefined): 'admin' | 'seller' | 'buyer' {
  if (!role) return 'buyer';
  const lower = role.toLowerCase();
  return KNOWN_ROLES.has(lower) ? (lower as 'admin' | 'seller' | 'buyer') : 'buyer';
}

export type LegacyAd = { _id: string; title: string; status?: string };
export type MergedAd = LegacyAd & { status: 'APPROVED' | 'PENDING' };

/**
 * Section 12.1 hazard 2: `approvedAds` duplicates rows already in `ads`. The legacy
 * DELETE /approvedAds/:id handler even deleted from the wrong collection. Both
 * collections collapse into one `ad_campaigns` table with a status enum.
 */
export function dedupeAds(ads: LegacyAd[], approvedAds: LegacyAd[]): MergedAd[] {
  const approvedIds = new Set(approvedAds.map((a) => a._id));
  const byId = new Map<string, MergedAd>();

  for (const ad of [...ads, ...approvedAds]) {
    if (byId.has(ad._id)) continue;
    byId.set(ad._id, { ...ad, status: approvedIds.has(ad._id) ? 'APPROVED' : 'PENDING' });
  }

  return [...byId.values()];
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @nexmarket/mongo-etl test`
Expected: PASS, all 13 cases green.

- [ ] **Step 7: Write the extract, verify, and CLI skeletons**

Create `scripts/mongo-etl/src/extract.ts`:

```ts
import { MongoClient } from 'mongodb';
import { MONGO_COLLECTIONS, type ExtractReport, type MongoCollection } from './types.js';

/**
 * Stage 1 of 4. Reads each legacy collection into typed intermediate JSON so the
 * transform stage is a pure function over data, testable without a Mongo instance.
 */
export async function extract(
  mongoUrl: string,
  dbName: string,
): Promise<{ data: Record<MongoCollection, unknown[]>; reports: ExtractReport[] }> {
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);

    const data = {} as Record<MongoCollection, unknown[]>;
    const reports: ExtractReport[] = [];

    for (const collection of MONGO_COLLECTIONS) {
      const docs = await db.collection(collection).find({}).toArray();
      data[collection] = docs;
      reports.push({ collection, documentCount: docs.length });
    }

    return { data, reports };
  } finally {
    await client.close();
  }
}
```

Create `scripts/mongo-etl/src/verify.ts`:

```ts
import type { ExtractReport, QuarantinedRow } from './types.js';

export type VerifyResult = {
  ok: boolean;
  extracted: ExtractReport[];
  quarantined: QuarantinedRow[];
  notes: string[];
};

/**
 * Stage 4 of 4. Row-count reconciliation and a quarantine report.
 * Referential-integrity and ledger-balance checks are added in Phase 4, when the
 * ledger tables they check against exist.
 */
export function verify(
  extracted: ExtractReport[],
  quarantined: QuarantinedRow[],
): VerifyResult {
  const notes = quarantined.map((q) => `${q.collection}/${q.id}: ${q.reason}`);
  return {
    ok: true,
    extracted,
    quarantined,
    notes: notes.length > 0 ? notes : ['No rows quarantined.'],
  };
}
```

Create `scripts/mongo-etl/src/main.ts`:

```ts
import { extract } from './extract.js';
import { verify } from './verify.js';

/**
 * Phase 0 ships extract, transform and verify. The LOAD stage lands with the schema
 * it targets: it cannot insert orders and ledger entries into tables that Phase 4
 * has not created yet. Running this now produces an extract and quarantine report.
 */
async function main(): Promise<void> {
  const mongoUrl = process.env.LEGACY_MONGO_URL;
  const dbName = process.env.LEGACY_MONGO_DB;

  if (!mongoUrl || !dbName) {
    console.error('Set LEGACY_MONGO_URL and LEGACY_MONGO_DB to run the ETL.');
    process.exitCode = 1;
    return;
  }

  const { reports } = await extract(mongoUrl, dbName);
  const result = verify(reports, []);

  console.log('Extract report:');
  for (const r of result.extracted) {
    console.log(`  ${r.collection}: ${r.documentCount} documents`);
  }
  console.log('Notes:', result.notes.join('\n  '));
  console.log('\nLoad stage is not implemented yet. It lands with Phase 4.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Write the ETL README**

Create `scripts/mongo-etl/README.md` documenting: the four stages, the eight source collections, the target table mapping from PRD §8.1, the five hazards from §12.1 and which are handled where, the two env vars, and the explicit statement that the load stage arrives with Phase 4. State plainly that prescription-only legacy products are **dropped, not migrated**, and reported.

- [ ] **Step 9: Commit**

```bash
git add scripts/mongo-etl
git commit -m "feat(etl): mongo extract/transform/verify skeleton with hazard handling"
```

---

## Task 13: CI and the Neon branch-per-PR workflow

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/neon-branch.yml`

**Interfaces:**
- Consumes: every package's `lint`, `type-check`, `test`, `build` script.
- Produces: a green CI run on push and PR.

The Neon workflow is credential-gated: it skips cleanly when `NEON_API_KEY` is absent, so CI stays green before the Neon project exists.

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, modernization]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm type-check

      # Testcontainers boots real Postgres per suite; ubuntu-latest ships Docker.
      # RLS cannot be meaningfully mocked (PRD 7.3), so this must be a real database.
      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **Step 2: Write the Neon branch-per-PR workflow**

Create `.github/workflows/neon-branch.yml`:

```yaml
name: Neon PR branch

on:
  pull_request:
    types: [opened, reopened, synchronize, closed]

jobs:
  branch:
    runs-on: ubuntu-latest
    # Skips cleanly until the Neon project exists and the secrets are set.
    if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}
    steps:
      - name: Check for Neon credentials
        id: creds
        run: |
          if [ -n "${{ secrets.NEON_API_KEY }}" ] && [ -n "${{ vars.NEON_PROJECT_ID }}" ]; then
            echo "present=true" >> "$GITHUB_OUTPUT"
          else
            echo "present=false" >> "$GITHUB_OUTPUT"
            echo "NEON_API_KEY or NEON_PROJECT_ID not configured; skipping."
          fi

      - uses: actions/checkout@v4
        if: steps.creds.outputs.present == 'true'

      - name: Create Neon branch
        if: steps.creds.outputs.present == 'true' && github.event.action != 'closed'
        uses: neondatabase/create-branch-action@v5
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch_name: pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}

      - name: Delete Neon branch
        if: steps.creds.outputs.present == 'true' && github.event.action == 'closed'
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

- [ ] **Step 3: Document the Neon setup steps that need a human**

Create `docs/runbook/neon-setup.md` recording, as an explicit checklist for whoever has the account:

1. Create a Neon project; note the project ID.
2. Create a role `nexmarket_app` in the Neon SQL editor with `NOBYPASSRLS`, and grant it as in `docker/postgres-init/01-app-role.sql`. **`neondb_owner` carries `rolbypassrls` and must never be the application's `DATABASE_URL`** — using it makes every RLS policy inert.
3. Set repository secret `NEON_API_KEY` and repository variable `NEON_PROJECT_ID`.
4. Set `DATABASE_URL` (as `nexmarket_app`) and `DATABASE_MIGRATION_URL` (as `neondb_owner`) in the deploy environment.
5. Verify with `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;` connected via `DATABASE_URL` — it must return `f`.

- [ ] **Step 4: Verify CI locally before pushing**

Run: `pnpm lint && pnpm type-check && pnpm test && pnpm build`
Expected: all four succeed. Fix anything red here rather than discovering it in CI.

- [ ] **Step 5: Commit and push, then confirm the run is green**

```bash
git add .github docs/runbook
git commit -m "ci: lint, type-check, test and build on every push; credential-gated neon branching"
git push
```

Expected: the `CI / verify` check passes on GitHub. The `Neon PR branch` job runs and reports the skip message.

---

## Task 14: Documentation truth pass and ADRs

**Files:**
- Modify: `README.md`
- Create: `docs/architecture/0001-monorepo-and-stack.md`, `docs/architecture/0002-drizzle-over-prisma.md`, `docs/architecture/0003-rls-app-role-and-pooling.md`, `docs/architecture/0004-local-docker-vs-neon.md`, `docs/architecture/0005-db-push-runs-migrations.md`

**Interfaces:**
- Consumes: everything.
- Produces: a README whose claims are all true.

The current README opens with "**There is no application code in this repository yet.**" After Task 13 that is false, and §13 requires a true README. This task is not optional polish — it is the acceptance criterion "Repo README with true claims".

- [ ] **Step 1: Record the resolved dependency versions**

```bash
pnpm ls --depth 0 --recursive --json > /tmp/versions.json
```

Read the actual resolved versions of turbo, typescript, nestjs, next, drizzle-orm, drizzle-kit, pg, bullmq, vitest and testcontainers. These go into ADR 0001. Do not write a version you have not read from this output.

- [ ] **Step 2: Write ADR 0001 — monorepo and stack**

Record: pnpm workspaces + Turborepo, the app/package split, the resolved versions from Step 1, and why a monorepo (shared types across the tier boundary; a code buyer clones one repo). Cite PRD §7.3.

- [ ] **Step 3: Write ADR 0002 — Drizzle over Prisma**

Record the reason from PRD §7.3 verbatim: RLS needs per-request session variables set inside a transaction, which Prisma handles awkwardly under connection pooling; SQL-first reads well to a code buyer. Mark the claim `stated, not benchmarked` — it is a design rationale, not a measurement.

- [ ] **Step 4: Write ADR 0003 — the RLS app role and the pooling hazard**

The most important ADR in Phase 0. Record:
- Tenant context is set with `set_config(..., true)`, never plain `SET`, and always inside a transaction. Explain the leak mechanism.
- `FORCE ROW LEVEL SECURITY` is required, because the table owner bypasses policies without it.
- The application connects as `nexmarket_app`, a role with `NOBYPASSRLS`. On Neon, `neondb_owner` carries `rolbypassrls` and must never be the app's `DATABASE_URL`.
- The four §6.4 acceptance criteria and where each is discharged: criterion 2 (lint rule) and criteria 3 and 4 (tests) land in Phase 0; criterion 1 (the NestJS interceptor) lands in Phase 1 with the first tenant-scoped route.

- [ ] **Step 5: Write ADR 0004 — local Docker for dev, Neon for deploy**

Record scoping decision D-A: the same `pg` TCP driver serves both, so §6.5 holds identically and no code path branches. S4 requires a clean machine to reach a running app in under 10 minutes, which a required Neon account would break.

- [ ] **Step 6: Write ADR 0005 — `db:push` runs migrations**

Record scoping decision D-C: `drizzle-kit push` cannot express `CREATE POLICY`, `FORCE ROW LEVEL SECURITY`, or role grants, so the documented `pnpm db:push` one-liner is implemented as `drizzle-kit migrate`. State the alias explicitly so nobody "fixes" it later.

- [ ] **Step 7: Rewrite the README status section**

Replace the "Status: pre-implementation" block. The new text must state what is actually true:

- Phase 0 is complete; Phases 1 through 12 have not started
- What runs today: `pnpm i && docker compose up -d && pnpm db:push && pnpm seed && pnpm dev` brings up the API on :4000 with `/health` and `/docs`, the web app on :3000, and the worker
- What does NOT exist yet: authentication, tenants beyond the seed rows, catalogue, cart, orders, ledger
- Tick the Phase 0 checkbox in the roadmap table and leave 1 through 12 unticked
- Update "Repository layout / Today" to the real structure
- Add the CI badge

Do not overstate. §13 requires a true README, and OVERVIEW.md documents that all three previous READMEs described software that did not exist. That is the specific failure this project is a reaction to.

- [ ] **Step 8: Verify the README's central claim by running it on a clean checkout**

```bash
git clone . /tmp/nexmarket-clean && cd /tmp/nexmarket-clean
cp .env.example .env
pnpm install && docker compose up -d && pnpm db:push && pnpm seed
```
Expected: every command succeeds. Time it — S4 requires under 10 minutes. If it fails, the README is wrong, not the test.

- [ ] **Step 9: Commit**

```bash
git add README.md docs/architecture
git commit -m "docs: five phase-0 ADRs and a README whose claims are all true"
```

---

## Phase 0 exit checklist

Every item is a PRD acceptance criterion. Phase 0 is not done until all are ticked.

- [ ] `pnpm i && pnpm db:push && pnpm seed && pnpm dev` succeeds on a clean machine in under 10 minutes (S4)
- [ ] CI is green: lint, type-check, test, build (§11 Phase 0 acceptance)
- [ ] The startup assertion proves the driver supports interactive transactions, and fails the boot when it does not (§6.5)
- [ ] The connecting role has `rolsuper = f` and `rolbypassrls = f`, asserted by a test (§6.3)
- [ ] `rls_probe` has both `relrowsecurity` and `relforcerowsecurity` set to `t` (§6.3)
- [ ] Omitting tenant context returns zero rows, never all rows (§6.4 criterion 4)
- [ ] Two tenants interleaved over a shared pool produce zero cross-reads (§6.4 criterion 3, S1)
- [ ] Tenant context does not survive past its transaction on a reused connection (§6.4)
- [ ] The lint rule forbids importing the raw `db` handle outside `packages/db` (§6.4 criterion 2)
- [ ] 100% coverage on `money.ts`, `tenant-context.ts`, `assert-driver.ts` (§13)
- [ ] Zero `any` in `src/` (S7)
- [ ] 32 shadcn primitives salvaged; `product-card-enhanced.tsx` excluded; `components.json` `hooks` alias fixed (§12.1)
- [ ] `old-code/` and `frontend/` are in `archive/`, moved with `git mv` so history follows (§12.1)
- [ ] The ETL skeleton handles the `temp-` id, `approvedAds` duplication, float-rounding, and missing-role hazards, with tests (§12.1)
- [ ] Five ADRs written; README claims verified against a clean clone (§13)

**Deferred to Phase 1, deliberately:** the NestJS `TenantInterceptor` (§6.4 criterion 1) — there is no tenant-scoped route in Phase 0 for it to wrap, and an interceptor with nothing to intercept cannot be tested honestly. Task 7 proves the mechanism it will call.

**Deferred to Phase 4, deliberately:** the ETL load and the ledger-balance check — they cannot insert into tables that do not exist yet.

---

## Self-review notes

Checked against the spec on 2026-08-23.

**Spec coverage.** PRD §11 Phase 0 lists nine scope items. Monorepo → Task 1. Neon branch-per-PR → Task 13. Drizzle setup → Task 5. Base schema → Task 6. CI → Task 13. Docker Compose → Task 4. Seed harness → Task 8. ETL skeleton → Task 12. `archive/` move → Task 1. §12.1 salvage → Tasks 2 and 10. §6.5 driver assertion → Tasks 5 and 9. Acceptance command `pnpm i && pnpm db:push && pnpm seed && pnpm dev` → Tasks 1, 6, 8, and verified end to end in Task 14 Step 8.

**Deliberate gaps, both stated in the exit checklist.** §6.4 criterion 1 (the interceptor) needs a tenant-scoped route, which Phase 1 introduces. The ETL load stage needs Phase 4's tables. Everything else in Phase 0's scope is discharged here.

**Type consistency.** `Money` is `{ amount, currency }` in Task 3 and consumed with that shape in Task 12. `TenantContext` is `{ tenantId, isAdmin }` in Task 7 and matches the PRD §6.4 signature. `makeWithTenant(db)` returns the `withTenant` used in tests; the module-level `withTenant` is the production binding. `QUEUE_NAMES` is a readonly tuple in Task 11 and indexed as such. `SeedSummary` keys (`countries`, `currencies`, `organisations`) match what `seedReferenceData` and `seedOrganisations` return.

**One known ordering constraint.** Task 5 Step 7 creates `packages/db/src/index.ts`, which imports `./schema/index.js` — a file Task 6 creates. `packages/db` does not type-check between those two tasks. This is called out in Task 5 Step 7 and is why Task 6 must follow Task 5 immediately.
