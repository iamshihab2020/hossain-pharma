# Testing Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four testing layers that block merge — cross-browser E2E walking PRD
S2 as far as Phase 5 reaches, an axe pass on buyer surfaces, visual baselines on
four screens, client-component tests, and a k6 load test aimed at the stock race.

**Architecture:** One new package `apps/e2e` holds Playwright, and a11y and
visual assertions ride inside its journeys rather than forming suites of their
own. A second Vitest project inside `apps/web` covers client components in jsdom
while `lib/` stays in node. k6 runs from its Docker image against the same
throwaway stack. Nothing runs against the dev database on 5433.

**Tech Stack:** Playwright, `@axe-core/playwright`, Testing Library + jsdom,
k6 (Docker), Docker Compose profiles.

**Spec:** `docs/superpowers/specs/2026-09-11-testing-layers-design.md` — read it
first. This plan argues from it and does not repeat its reasoning.

## Global Constraints

- **Never touch the dev stack.** Postgres 5433 and Redis 6380 belong to
  development. The test stack is **5434 / 6381**, and API **4001** / web
  **3001**. All four were confirmed free with `docker ps` and `netstat`.
- **Run `docker ps` before adding any service to compose** — CLAUDE.md requires
  it, and it is how the 5433/6380 shift came about in the first place.
- **A gate is what blocks merge, not what runs in one command.** `pnpm test`
  gains only the component tests. E2E and load get their own scripts and their
  own CI jobs, following the search benchmark's precedent.
- **Gate on `serious` and `critical` axe violations only.** Lower severities are
  reported, never enforced.
- **Visual baselines are generated in Linux**, in the `mcr.microsoft.com/playwright`
  image pinned to the exact resolved `@playwright/test` version. Host-generated
  PNGs will not match CI.
- **Playwright needs an `allowBuilds` entry** in `pnpm-workspace.yaml` or pnpm 11
  blocks its postinstall and every test fails at run time rather than install.
- **Do not re-assert in the browser what the API suite proves to the minor
  unit.** The E2E suite checks that screens work, not that the ledger balances.
- The four existing gates must keep passing: `pnpm lint && pnpm type-check &&
  pnpm test && pnpm build`.
- **`pnpm test` currently OOMs on this machine when run across packages.** Verify
  with `pnpm turbo test --concurrency=1`, or per package.
- **Every commit message ends with:**
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/e2e/package.json` | The package. Scripts: `e2e`, `e2e:ui`, `e2e:baseline` |
| `apps/e2e/playwright.config.ts` | Projects per browser, `webServer` for API and web, baseURL from env |
| `apps/e2e/global-setup.ts` | Drops, migrates and seeds the test database once per run |
| `apps/e2e/fixtures/actors.ts` | Registering a buyer, signing in a seller, namespaced emails |
| `apps/e2e/journeys/buyer.spec.ts` | PRD S2 prefix: browse → search → 3-seller cart → checkout → 3 orders |
| `apps/e2e/journeys/fulfilment.spec.ts` | accept → partial dispatch → deliver → buyer timeline |
| `apps/e2e/a11y/scan.ts` | The shared axe helper and its severity gate |
| `apps/e2e/visual/screens.spec.ts` | Four baselines |
| `apps/e2e/README.md` | How to run, and how to regenerate baselines |
| `apps/web/components/*.test.tsx` | Five client-component suites |
| `scripts/load/package.json`, `scripts/load/checkout.js` | k6 scenario and thresholds |

**Modified:** `docker-compose.yml` (an `e2e` profile), `.env.example` (the test
stack's variables), `pnpm-workspace.yaml` (allowBuilds), `turbo.json` (an `e2e`
task), root `package.json` (`e2e`, `e2e:baseline`, `load` scripts),
`apps/web/vitest.config.ts` (two projects), `apps/web/package.json` (deps),
`.github/workflows/ci.yml` (two jobs), `CLAUDE.md`.

**Interfaces every later task depends on:**

```ts
// apps/e2e/fixtures/actors.ts
export type Actor = { email: string; password: string; token: string; userId: string };
export function ns(prefix: string): string;                       // 'e2e-buyer-3f2a'
export async function registerBuyer(page: Page, label: string): Promise<Actor>;
export async function signIn(page: Page, actor: Actor): Promise<void>;
export async function sellerFor(request: APIRequestContext, slug: string): Promise<{
  email: string; password: string; tenantId: string;
}>;

// apps/e2e/a11y/scan.ts
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void>;
```

---

## Task 1: The test stack

**Files:**
- Modify: `docker-compose.yml`, `.env.example`
- Create: `apps/e2e/.env.e2e`

**Interfaces:**
- Produces: Postgres on **5434**, Redis on **6381**, database `nexmarket_e2e`,
  both behind the compose profile `e2e` so plain `docker compose up -d` is
  unchanged.

- [ ] **Step 1: Confirm the ports are free before claiming them**

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
netstat -ano | grep -E ":(5434|6381|3001|4001)\s"
```
Expected: the two dev containers only, and no output from `netstat`. If anything
answers, pick the next free pair and change it everywhere in this plan — do not
proceed with a clashing port.

- [ ] **Step 2: Add the profile to `docker-compose.yml`**

```yaml
  # THE TEST STACK. Behind a profile, so `docker compose up -d` for development
  # starts nothing extra and the dev database on 5433 is never involved in a
  # test run - the e2e suite DROPS its schema on every run, which is a thing you
  # want nowhere near data you were mid-way through debugging.
  postgres-e2e:
    profiles: ['e2e']
    image: postgres:16-alpine
    container_name: nexmarket-postgres-e2e
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: nexmarket_e2e
    ports:
      - '5434:5432'
    # NO named volume, deliberately: this database is disposable, and a volume
    # would carry yesterday's rows into today's run.
    volumes:
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d nexmarket_e2e']
      interval: 5s
      timeout: 5s
      retries: 10

  redis-e2e:
    profiles: ['e2e']
    image: redis:7-alpine
    container_name: nexmarket-redis-e2e
    ports:
      - '6381:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10
```

- [ ] **Step 3: Start it and prove the app role exists**

The init script in `docker/postgres-init` creates `nexmarket_app` as
`NOBYPASSRLS`. If it did not run, every RLS policy in the test stack would be
decoration.

```bash
docker compose --profile e2e up -d
docker compose exec -T postgres-e2e psql -U postgres -d nexmarket_e2e \
  -c "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'nexmarket_app';"
```
Expected: one row, `rolbypassrls = f`.

- [ ] **Step 4: Write the env file the suite will load**

`apps/e2e/.env.e2e`:

```
NODE_ENV=test
DATABASE_URL=postgres://nexmarket_app:nexmarket_dev_password@localhost:5434/nexmarket_e2e
DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:5434/nexmarket_e2e
REDIS_URL=redis://localhost:6381
API_PORT=4001
API_HOST=127.0.0.1
JWT_ACCESS_SECRET=e2e-only-access-secret-change-me-32chars
JWT_REFRESH_SECRET=e2e-only-refresh-secret-change-me-32char
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
WEB_APP_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:4001
FILE_STORAGE_DIR=.nexmarket/e2e-uploads
PAYMENT_WEBHOOK_SECRET=e2e-webhook-secret-change-me-32-chars
```

- [ ] **Step 5: Prove migrate and seed work against it**

```bash
DATABASE_URL='postgres://nexmarket_app:nexmarket_dev_password@localhost:5434/nexmarket_e2e' \
DATABASE_MIGRATION_URL='postgres://postgres:postgres@localhost:5434/nexmarket_e2e' \
  pnpm db:push && pnpm seed
```
Expected: "Migrations applied." then the seed summary. If the seed reports zero
`orgMembers`, the app role is missing and Step 3 lied — CLAUDE.md explains why
that failure is silent.

- [ ] **Step 6: Document the ports in `.env.example`**

Add, below the existing database block:

```
# --- Test stack (docker compose --profile e2e) ------------------------------
# 5434/6381, and a SEPARATE database. The e2e suite drops its schema on every
# run; pointing it at 5433 would drop yours.
# E2E_DATABASE_URL=postgres://nexmarket_app:nexmarket_dev_password@localhost:5434/nexmarket_e2e
```

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/e2e/.env.e2e
git commit -m "test: a disposable stack on 5434/6381, behind a compose profile"
```

---

## Task 2: The Playwright harness

**Files:**
- Create: `apps/e2e/package.json`, `playwright.config.ts`, `global-setup.ts`,
  `journeys/smoke.spec.ts`
- Modify: `pnpm-workspace.yaml`, `turbo.json`, root `package.json`

**Interfaces:**
- Consumes: the stack from Task 1
- Produces: `pnpm e2e` runs Playwright against a freshly seeded database with
  the API on 4001 and web on 3001; `E2E_BASE_URL` overrides the target and
  `E2E_NO_SERVER=1` skips `webServer` for the containerised baseline run.

- [ ] **Step 1: Add the package and allow Playwright's postinstall**

`apps/e2e/package.json`:

```json
{
  "name": "@nexmarket/e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "test": "echo 'e2e runs via pnpm e2e, not pnpm test - see the plan'"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.10.1",
    "@nexmarket/api-client": "workspace:*",
    "@nexmarket/config": "workspace:*",
    "@nexmarket/db": "workspace:*",
    "@playwright/test": "^1.56.0",
    "typescript": "^5.9.3"
  }
}
```

`test` deliberately echoes rather than running Playwright: `pnpm test` must not
grow browsers. In `pnpm-workspace.yaml` under `allowBuilds`:

```yaml
  # Downloads the browser binaries on install. Without this pnpm 11 blocks the
  # postinstall and every test fails at RUN time with "browser not found",
  # which is a much worse place to learn about it than install time.
  '@playwright/test': true
```

Root `package.json` scripts:

```json
    "e2e": "pnpm --filter @nexmarket/e2e e2e",
    "e2e:baseline": "pnpm --filter @nexmarket/e2e e2e:baseline",
    "load": "pnpm --filter @nexmarket/load load"
```

- [ ] **Step 2: Write the config**

`apps/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, '.env.e2e') });

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3001';

/**
 * Chromium always; Firefox and WebKit only in CI.
 *
 * Three browsers driving a full stack on a 7.6 GB machine is where this suite
 * stops being usable locally, and a gate people stop running is worse than no
 * gate. CI has the headroom, and CI is what blocks merge.
 */
const crossBrowser = process.env['CI'] === 'true' || process.env['E2E_ALL_BROWSERS'] === '1';

export default defineConfig({
  testDir: here,
  // Serial locally. The suite mutates stock and order state, and two workers
  // racing over one seeded catalogue is non-determinism a GATE cannot have.
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: process.env['CI'] === 'true' ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: join(here, 'global-setup.ts'),
  use: {
    baseURL: BASE_URL,
    // Artefacts only when something broke - a green run should leave nothing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(crossBrowser
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  // Skipped when the run is inside the baseline container, which talks to
  // servers already running on the host.
  ...(process.env['E2E_NO_SERVER'] === '1'
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter @nexmarket/api start',
            url: 'http://localhost:4001/health',
            reuseExistingServer: process.env['CI'] !== 'true',
            timeout: 120_000,
          },
          {
            command: 'pnpm --filter @nexmarket/web start --port 3001',
            url: BASE_URL,
            reuseExistingServer: process.env['CI'] !== 'true',
            timeout: 120_000,
          },
        ],
      }),
});
```

- [ ] **Step 3: Write global setup**

`apps/e2e/global-setup.ts`:

```ts
import { execSync } from 'node:child_process';

/**
 * One clean database per RUN, not per test.
 *
 * Dropping the schema and re-migrating costs ~15 seconds and buys the property
 * a gate needs: the same starting state every time. Per-test reset would triple
 * the runtime, and the journeys are written to be independent anyway - each
 * registers its own buyer under a namespaced email, exactly as the API e2e
 * suite does.
 */
export default function globalSetup(): void {
  const env = { ...process.env, ...envFromFile() };

  execSync(
    `psql "${env['DATABASE_MIGRATION_URL']}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
    { stdio: 'inherit' },
  );
  execSync('pnpm db:push', { stdio: 'inherit', env, cwd: repoRoot() });
  execSync('pnpm seed', { stdio: 'inherit', env, cwd: repoRoot() });
}
```

`envFromFile()` reads `.env.e2e` and `repoRoot()` walks up two directories —
both are four lines and belong in this file rather than a helper.

**If `psql` is not on PATH** (likely on Windows), run it through the container
instead:

```ts
execSync(
  'docker compose exec -T postgres-e2e psql -U postgres -d nexmarket_e2e ' +
    '-c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"',
  { stdio: 'inherit', cwd: repoRoot() },
);
```

- [ ] **Step 4: Write the smoke test that proves the harness, not the app**

`apps/e2e/journeys/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * The harness test. It exists to fail loudly when the STACK is wrong - wrong
 * port, unseeded database, web app pointed at the wrong API - so that a real
 * journey failing means the journey is broken rather than the plumbing.
 */
test('the storefront answers, with seeded products', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/NexMarket/i);

  const response = await page.request.get('http://localhost:4001/health');
  expect(response.ok()).toBe(true);
});
```

- [ ] **Step 5: Install and run**

```bash
pnpm install
pnpm --filter @nexmarket/e2e exec playwright install chromium
pnpm --filter @nexmarket/api build && pnpm --filter @nexmarket/web build
pnpm e2e
```
Expected: one passing test. If the web server times out, check that
`NEXT_PUBLIC_API_URL` reached it — the app defaults to port 4000 and would
silently talk to your dev API.

- [ ] **Step 6: Add the turbo task**

In `turbo.json` under `tasks`, so the E2E build dependency is declared rather
than assumed:

```json
    "e2e": {
      "dependsOn": ["^build"],
      "cache": false
    }
```

- [ ] **Step 7: Commit**

```bash
git add apps/e2e pnpm-workspace.yaml turbo.json package.json pnpm-lock.yaml
git commit -m "test: a Playwright harness against the disposable stack"
```

---

## Task 3: The buyer journey

**Files:**
- Create: `apps/e2e/fixtures/actors.ts`, `apps/e2e/journeys/buyer.spec.ts`
- Delete: `apps/e2e/journeys/smoke.spec.ts` (its job is done by a real journey)

**Interfaces:**
- Produces: `ns`, `registerBuyer`, `signIn`, `Actor` — signatures in the File
  Structure block above.

- [ ] **Step 1: Write the actors fixture**

```ts
// apps/e2e/fixtures/actors.ts
import { expect, type Page } from '@playwright/test';

export type Actor = { email: string; password: string };

/** Namespaced per run. `users.email` is globally unique and the seed persists
 *  across a run, so a fixed address is a 409 on the second test. */
export function ns(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function registerBuyer(page: Page, label: string): Promise<Actor> {
  const actor = { email: `${ns(label)}@example.test`, password: 'e2e-password-1' };

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(actor.email);
  await page.getByLabel(/password/i).fill(actor.password);
  await page.getByLabel(/name/i).fill('E2E Buyer');
  await page.getByRole('button', { name: /create account|register|sign up/i }).click();

  await expect(page).not.toHaveURL(/\/register$/);
  return actor;
}

export async function signIn(page: Page, actor: Actor): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel(/email/i).fill(actor.email);
  await page.getByLabel(/password/i).fill(actor.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/signin$/);
}
```

**If a selector does not match**, fix the SELECTOR by reading the component, and
if the component has no accessible name, fix the COMPONENT — an input a test
cannot find by label is an input a screen reader cannot announce, and Task 5
would have caught it anyway.

- [ ] **Step 2: Write the failing journey**

```ts
// apps/e2e/journeys/buyer.spec.ts
import { expect, test } from '@playwright/test';
import { registerBuyer } from '../fixtures/actors.js';

/**
 * PRD §4.3 S2, as far as Phase 5 reaches:
 *
 *   browse → search → cart (3 sellers) → checkout → 3 orders
 *
 * The remaining steps - ship, deliver - are `fulfilment.spec.ts`, and
 * review/return/refund are Phases 7 and 8 and are absent on purpose.
 *
 * THREE SELLERS is the clause that makes this a marketplace test. One seller
 * would satisfy the sentence while proving nothing about splitting a basket.
 */
test('a basket spanning three sellers becomes three orders', async ({ page }) => {
  await registerBuyer(page, 'e2e-buyer');

  await page.goto('/search?q=redmi');
  const firstResult = page.getByRole('link', { name: /redmi/i }).first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();

  // The buy box ranks on LANDED price, and the page must say so rather than
  // presenting an estimate as a quote.
  const offers = page.getByRole('row');
  await expect(offers.first()).toBeVisible();
  await expect(page.getByText(/delivered price/i)).toBeVisible();

  // Add three DIFFERENT sellers' offers.
  const addButtons = page.getByRole('button', { name: /add to cart/i });
  const sellerCount = Math.min(3, await addButtons.count());
  expect(sellerCount).toBe(3);
  for (let index = 0; index < 3; index += 1) {
    await addButtons.nth(index).click();
  }

  await page.goto('/cart');
  await expect(page.getByText(/3 sellers|three sellers/i)).toBeVisible();

  await page.goto('/checkout');
  await fillAddress(page);
  await page.getByRole('button', { name: /place order|pay/i }).click();

  await expect(page).toHaveURL(/\/orders/);
  await page.goto('/orders');
  await expect(page.getByRole('listitem')).toHaveCount(3);
});
```

`fillAddress` fills recipient, phone, line 1, city, district, postcode and
country with the same values the API suite uses (`12 Elephant Road`, Dhaka,
`1205`, `BD`), and lives at the bottom of this file.

- [ ] **Step 3: Run it and watch it fail**

`pnpm e2e -- --project=chromium journeys/buyer`
Expected: FAIL. The first failure is likely a selector, not the app.

- [ ] **Step 4: Make it pass by fixing selectors, not by weakening assertions**

Read the component when a locator misses. **Do not** replace a role-based
locator with a CSS class or a test id to make it pass — an accessible name is
the thing Task 5 gates on anyway, and a `.css-1x2y3z` selector breaks on the
next Tailwind change.

- [ ] **Step 5: Delete the smoke test and run the suite**

```bash
rm apps/e2e/journeys/smoke.spec.ts
pnpm e2e
```
Expected: one passing journey.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e
git commit -m "test(e2e): PRD S2 to the Phase 5 boundary - three sellers, three orders"
```

---

## Task 4: The fulfilment journey

**Files:**
- Create: `apps/e2e/journeys/fulfilment.spec.ts`
- Modify: `apps/e2e/fixtures/actors.ts` (add `sellerFor`)

**Interfaces:**
- Consumes: `registerBuyer`, `signIn`
- Produces: `sellerFor(request, slug)` returning the seeded owner's credentials
  and tenant id for a demo organisation

- [ ] **Step 1: Add the seller fixture**

The demo seed creates organisations with owners. `sellerFor` signs in as one
through the API and returns the credentials the browser will use, so the journey
does not have to discover them through the UI.

```ts
export async function sellerFor(
  request: APIRequestContext,
  orgSlug: string,
): Promise<{ email: string; password: string; tenantId: string }> {
  // The seed's owner accounts share one development password; the seed is the
  // source of truth for both, so read it there rather than hard-coding a guess.
  ...
}
```

**Before writing it, read `packages/db/src/seed/organisations.ts` and
`seed/users.ts`** for the actual owner email and password, and use those. A
guessed credential produces a 401 that looks like a broken sign-in page.

- [ ] **Step 2: Write the failing journey**

```ts
// apps/e2e/journeys/fulfilment.spec.ts
import { expect, test } from '@playwright/test';

/**
 * S2 continued: ship → deliver, and the half of Phase 5's acceptance criterion
 * that is VISIBLE - a seller fulfils their own order and the buyer's other two
 * are untouched.
 *
 * The arithmetic is not re-asserted here. `apps/api/test/fulfilment.e2e.test.ts`
 * proves the releases sum to the order total to the minor unit, and repeating
 * that in a browser buys nothing but a second thing to update.
 */
test('a seller ships part of an order and the buyer watches it move', async ({ page, request }) => {
  // ... place an order as a buyer (reuse the buyer journey's helper)

  // Seller: accept, dispatch one unit with a carrier, mark delivered.
  await page.goto('/seller/orders');
  await page.getByRole('link', { name: /NM-/ }).first().click();
  await page.getByRole('button', { name: /accept this order/i }).click();

  await page.getByLabel(/carrier/i).fill('Pathao');
  await page.getByLabel(/tracking/i).fill('PT-E2E-1');
  await page.getByRole('button', { name: /dispatch parcel/i }).click();
  await expect(page.getByText(/part shipped|shipped/i)).toBeVisible();

  // Buyer: the timeline carries the carrier, and the other orders have not moved.
  await page.goto('/orders');
  // ... open the order, assert 'Dispatched with Pathao' and 'Tracking PT-E2E-1'
  // ... assert the other two orders still read 'Paid'
});
```

- [ ] **Step 3: Run it and watch it fail**

`pnpm e2e -- --project=chromium journeys/fulfilment`

- [ ] **Step 4: Make it pass**

- [ ] **Step 5: Run both journeys together**

```bash
pnpm e2e
```
Expected: two passing journeys. **They share one seeded database**, so if
`buyer` passes alone and fails after `fulfilment`, the fixtures are not as
independent as they claim — fix the fixture, not the order.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e
git commit -m "test(e2e): ship, deliver, and the buyer's timeline moving"
```

---

## Task 5: The a11y pass

**Files:**
- Create: `apps/e2e/a11y/scan.ts`
- Modify: both journey specs

**Interfaces:**
- Produces: `expectNoSeriousA11yViolations(page, label)`

- [ ] **Step 1: Write the helper**

```ts
// apps/e2e/a11y/scan.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * PRD S10: "WCAG 2.1 AA on buyer-facing pages; automated axe pass."
 *
 * SERIOUS and CRITICAL only. A `moderate` rule failing should not block a
 * ledger fix, and a gate that fires on everything is one people learn to skip.
 * Lower severities are printed so they are visible without being enforced.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const advisory = results.violations.filter((violation) => !blocking.includes(violation));

  if (advisory.length > 0) {
    console.log(`[a11y:${label}] ${String(advisory.length)} advisory finding(s):`,
      advisory.map((v) => `${v.id} (${String(v.impact)})`).join(', '));
  }

  expect(
    blocking.map((v) => `${v.id}: ${v.help} [${String(v.nodes.length)} node(s)]`),
    `serious or critical a11y violations on ${label}`,
  ).toEqual([]);
}
```

- [ ] **Step 2: Call it on the pages the journeys already open**

Buyer-facing, which is S10's scope: the product page, the cart, checkout, the
order detail. Plus the seller queue, because the browser is already there.

```ts
await expectNoSeriousA11yViolations(page, 'product page');
```

- [ ] **Step 3: Run and read what it finds**

`pnpm e2e -- --project=chromium`

Expected: **probably failures, and they are real.** The palette claims `muted`
is AA at 14px on both grounds and nothing has verified it. Fix what it finds:
a contrast failure is a token change in `packages/config/tailwind/globals.css`,
a missing label is a component change.

**Do not add rule exclusions to make this green.** If a finding is genuinely
wrong for this app, disable that rule with a comment naming why — an unexplained
`.disableRules()` is how an a11y gate becomes decoration.

- [ ] **Step 4: Commit, including any component or token fixes**

```bash
git add apps/e2e apps/web packages/config
git commit -m "test(a11y): axe on the buyer surfaces, gated on serious and critical"
```

---

## Task 6: Visual baselines

**Files:**
- Create: `apps/e2e/visual/screens.spec.ts`, `apps/e2e/scripts/baseline.sh`
- Modify: `apps/e2e/package.json` (the `e2e:baseline` script)

- [ ] **Step 1: Write the spec**

Four screens, each chosen because the design carries meaning there:

```ts
import { expect, test } from '@playwright/test';

/**
 * Baselines are generated in the Linux container, never on a developer's host -
 * font rasterisation differs and a Windows-rendered PNG will never match CI.
 * `pnpm e2e:baseline` is the only supported way to update these.
 *
 * maxDiffPixelRatio is not zero: antialiasing varies between runs of the same
 * renderer, and a suite that fails on three stray pixels teaches people to
 * regenerate baselines without looking, which defeats the point.
 */
const TOLERANCE = { maxDiffPixelRatio: 0.01 };

test('the buy box', async ({ page }) => {
  await page.goto('/p/redmi-note-14-5g');
  await expect(page.getByRole('table')).toHaveScreenshot('buy-box.png', TOLERANCE);
});
```

Then the order timeline, the seller queue, and the packing slip.

- [ ] **Step 2: Write the baseline script**

```bash
#!/usr/bin/env bash
# Regenerates visual baselines inside the SAME image CI uses.
#
# The tag must match the resolved @playwright/test version exactly. A different
# image is a different renderer, and every baseline it writes is wrong.
set -euo pipefail
VERSION="$(node -p "require('@playwright/test/package.json').version")"

docker run --rm \
  -v "$(pwd)/../..:/work" -w /work/apps/e2e \
  --add-host=host.docker.internal:host-gateway \
  -e E2E_NO_SERVER=1 \
  -e E2E_BASE_URL=http://host.docker.internal:3001 \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  npx playwright test visual --update-snapshots
```

The stack must already be running on the host: `pnpm dev` against the e2e env,
or the servers Playwright started. The container talks to it through
`host.docker.internal`, which is why `E2E_NO_SERVER` exists in the config.

- [ ] **Step 3: Generate the baselines and inspect every one by eye**

```bash
docker compose --profile e2e up -d
pnpm e2e:baseline
```
Then **open each PNG**. A baseline is a claim that this is what the screen
should look like; committing one without looking bakes in whatever was on screen,
including a bug.

- [ ] **Step 4: Verify they hold**

`pnpm e2e -- visual` twice. Expected: PASS both times. A second run that fails
means the tolerance is too tight or something on the page is non-deterministic —
a date, a random order. Freeze the source rather than widening the tolerance.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e
git commit -m "test(visual): four baselines, generated in the CI image"
```

---

## Task 7: Client component tests

**Files:**
- Modify: `apps/web/vitest.config.ts`, `apps/web/package.json`
- Create: `apps/web/components/fulfilment-panel.test.tsx`, `offer-table.test.tsx`,
  `checkout-panel.test.tsx`, `address-form.test.tsx`, `theme-toggle.test.tsx`

- [ ] **Step 1: Split the Vitest config into two projects**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * TWO projects, and the split is the Phase 5 decision narrowed rather than
 * reversed.
 *
 * `lib` stays in NODE: server components cannot be meaningfully driven by a DOM
 * testing library, so everything worth asserting was pushed into pure helpers.
 * `components` is JSDOM and covers only files carrying 'use client' - those are
 * ordinary React and a DOM library is exactly the right tool.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['components/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
```

Dependencies: `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event`, `jsdom`, `@vitejs/plugin-react`.
`vitest.setup.ts` is one line importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write the first failing test, on the component with the most logic**

`fulfilment-panel` decides which verbs exist for which status — the exact thing
a screenshot cannot check and a server test does not cover.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FulfilmentPanel } from './fulfilment-panel.js';

vi.mock('@/app/actions/fulfilment', () => ({
  acceptOrder: vi.fn(), rejectOrder: vi.fn(), dispatchShipment: vi.fn(),
  markDelivered: vi.fn(), cancelLines: vi.fn(),
}));

describe('FulfilmentPanel', () => {
  it('offers accept and decline on a paid order, and nothing else', () => {
    render(<FulfilmentPanel order={orderWith('PAID')} tenantId="t1" outstanding={[]} />);
    expect(screen.getByRole('button', { name: /accept this order/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dispatch parcel/i })).not.toBeInTheDocument();
  });

  it('offers dispatch once accepted, with units outstanding', () => { /* ... */ });

  it('offers nothing on a delivered order', () => {
    // A disabled row of every possible verb teaches the seller nothing about
    // where the order is. Absence is the design.
  });
});
```

- [ ] **Step 3: Run and watch it fail**

`pnpm --filter @nexmarket/web exec vitest run --project components`

- [ ] **Step 4: Make it pass**

The component already behaves this way; failures here are the harness — a
missing `jsdom`, an unmocked action, a path alias Vitest cannot resolve. Fix
those rather than the component.

- [ ] **Step 5: Write the remaining four**

`offer-table` (selecting a seller changes the total), `checkout-panel` and
`address-form` (validation and submitting states), `theme-toggle` (persistence,
with `localStorage` wrapped in try/catch as the storage rules require).

- [ ] **Step 6: Run both projects and the full package suite**

```bash
pnpm --filter @nexmarket/web test
```
Expected: the 39 existing `lib` tests plus the new component tests, all passing.

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "test(web): jsdom for client components, node for everything else"
```

---

## Task 8: The load test

**Files:**
- Create: `scripts/load/package.json`, `scripts/load/checkout.js`,
  `scripts/load/README.md`

- [ ] **Step 1: Write the scenario**

The target is contention, not throughput.

```js
// scripts/load/checkout.js
import http from 'k6/http';
import { check } from 'k6';

/**
 * FIFTY buyers, ONE listing, not enough stock for everyone.
 *
 * "Is the site fast" is not a useful question for a project with no users. The
 * useful question is whether the stock reservation holds under real pressure -
 * ADR 0017 documents a version that let TWO concurrent checkouts take the last
 * unit, and the fix is asserted today by exactly two simultaneous requests.
 *
 * A 409 here is the CORRECT answer, not a failure. What must never happen is a
 * 201 that oversold.
 */
export const options = {
  scenarios: {
    thundering_herd: { executor: 'per-vu-iterations', vus: 50, iterations: 1 },
  },
  thresholds: {
    // PRD §13: checkout p95 < 500 ms.
    'http_req_duration{name:confirm}': ['p(95)<500'],
    // Every response is either a placed order or an honest refusal.
    'checks{check:no_oversell}': ['rate==1.0'],
  },
};
```

Setup registers 50 buyers and seeds a listing with **10** units, so 40 of the 50
must be refused. Teardown asserts orders placed ≤ stock that existed.

- [ ] **Step 2: Run it against the test stack**

```bash
docker compose --profile e2e up -d
docker run --rm -i -v "$(pwd)/scripts/load:/scripts" \
  --add-host=host.docker.internal:host-gateway \
  grafana/k6 run /scripts/checkout.js -e BASE_URL=http://host.docker.internal:4001
```

- [ ] **Step 3: Read the result honestly**

If p95 exceeds 500 ms, that is a finding about the code, not a reason to raise
the threshold. Record it and fix or defer it deliberately.

If any oversell occurs, **stop and treat it as a bug** — the guard ADR 0017
describes has a hole, and that is precisely what this suite was built to find.

- [ ] **Step 4: Commit**

```bash
git add scripts/load package.json
git commit -m "test(load): fifty buyers, one listing, and the guard that has to hold"
```

---

## Task 9: CI and documentation

**Files:**
- Modify: `.github/workflows/ci.yml`, `CLAUDE.md`, `apps/e2e/README.md`

- [ ] **Step 1: Add the two jobs**

Both required, both alongside the existing three. The `e2e` job sets `CI=true`
so all three browsers run, caches browsers by the resolved Playwright version,
and starts Postgres and Redis as services on 5434/6381.

- [ ] **Step 2: Update `CLAUDE.md`**

- the commands block gains `pnpm e2e`, `pnpm e2e:baseline` and `pnpm load`
- "The four CI gates" becomes six, and says which run where and why E2E is not
  inside `pnpm test`
- the `apps/web` testing convention is narrowed: node for `lib/`, jsdom for
  client components, and the reason for each
- the ports section gains 5434/6381 and names the profile that owns them
- a line saying visual baselines are only ever regenerated in the container

- [ ] **Step 3: Write `apps/e2e/README.md`**

How to run, how to regenerate baselines, and what to do when a11y fails —
because regenerating baselines is the operation people get wrong, and it is the
one that silently bakes in a bug.

- [ ] **Step 4: Run every gate**

```bash
pnpm lint && pnpm type-check && pnpm build
pnpm turbo test --concurrency=1
pnpm e2e
pnpm load
```

- [ ] **Step 5: Commit**

```bash
git add .github CLAUDE.md apps/e2e/README.md
git commit -m "ci: e2e and load as required jobs, and the docs that say so"
```

---

## Self-review notes

- **Spec coverage.** §3 → Tasks 1-4; §4 → Task 5; §5 → Task 6; §6 → Task 7;
  §7 → Task 8; §8 and §10 → Task 9. §2's rejections need no task. §11's
  deferrals are deferrals.
- **Known risk, Task 3.** The selectors are written from the components as they
  are today and may not match exactly. That is deliberate: the plan says to fix
  the selector or the component, and never to reach for a CSS class to make a
  locator pass.
- **Known risk, Task 5.** The a11y pass is expected to fail first, and those
  failures are the point. Budget for token and component fixes inside that task.
- **Ordering constraint.** Task 6 depends on Task 3's pages being reachable, and
  Task 9 depends on everything. Tasks 7 and 8 are independent of the Playwright
  chain and can be done in any order relative to it.
