# Testing layers: E2E, a11y, visual regression, components and load

**Status:** proposed
**Date:** 2026-09-11
**Scope:** a new `apps/e2e` package, a second Vitest project in `apps/web`, a
`scripts/load` k6 suite, and two new CI jobs.

**Spec:** `docs/PRD-marketplace-migration.md` §4.3 (success criteria S2, S9,
S10), §13 (non-functional requirements), §11 Phase 12 (platform quality).

**This is not new scope.** The PRD already names the tools and the journeys:
§13 requires *"Playwright for the §4.3 S2/S3 journeys"* and *"axe in CI"*, and
S10 requires *"WCAG 2.1 AA on buyer-facing pages; automated axe pass"*. What
this design settles is how they are built, what they gate, and which parts can
exist before Phases 6-8 supply the rest of the journey.

It lands now rather than at Phase 12 because the surfaces it covers exist now,
and a suite written against them later is a suite written against code nobody
remembers.

---

## 1. What was decided before design

Four decisions are inputs here, not open questions:

| Decision | Consequence |
|---|---|
| These are **blocking gates** | Every suite must be fast and deterministic. A gate people learn to ignore is worse than no gate |
| The E2E stack is **its own compose profile on separate ports** | Your dev database at 5433 is never touched by a test run |
| **Two deep journeys**, not broad smoke coverage | Anything a unit or API test can prove is deliberately not repeated |
| **Firefox and WebKit are CI-only** | 7.6 GB of RAM with Docker running is the binding constraint locally |

### A gate is what blocks merge, not what runs in one command

`pnpm test` does not grow to twenty minutes. This repo already separates a
blocking check from the main command: the search benchmark has its own script
and its own CI job, because *"a benchmark sharing a database with eleven
parallel test files times the contention, not the query."* The same shape
applies here.

| Layer | Command | Blocks merge via |
|---|---|---|
| Client components | `pnpm test` | the existing gate job |
| E2E + a11y + visual | `pnpm e2e` | a new required CI job |
| Load | `pnpm load` | a new required CI job |

---

## 2. What is deliberately not here

Recording the rejections, because each was considered and the reasons matter
more than the list:

| Tool | Why not |
|---|---|
| **Cypress** | WebKit support is experimental, and WebKit is explicitly wanted. Playwright drives all three natively |
| **Percy / Chromatic** | Both are subscriptions that buy a pull-request review workflow this project does not have, and there is no deployment for them to compare against. Playwright's `toHaveScreenshot()` is free, local, and the same runner |
| **Lighthouse CI** | It would measure a dev-mode Next build, which describes the dev server rather than the product. A number that moves for reasons nobody controls is a gate that gets disabled |
| **Artillery** | k6's thresholds are the gate mechanism this needs, and running one load tool is cheaper than running two |
| **jsdom for server components** | Settled in Phase 5 and unchanged: a DOM testing library cannot meaningfully drive an async server component. This design narrows that decision to client components rather than reversing it |

---

## 3. Layer 1 — E2E, in `apps/e2e`

### Why its own package

The suite drives the **API and the web app together**. Burying it in `apps/web`
would imply it tests only the web app, and would put a browser dependency into
the package that has to build for production. It gets a `package.json` so turbo
can schedule it, and depends on `@nexmarket/api-client` so its setup speaks the
same typed endpoints the app does.

```
apps/e2e
  playwright.config.ts
  fixtures/stack.ts        seeding and reset, between runs
  journeys/buyer.spec.ts
  journeys/fulfilment.spec.ts
  a11y/scan.ts             shared axe helper
  visual/                  baselines, generated in Linux
```

### The stack

A compose **profile** named `e2e`, so `docker compose up -d` for development is
unchanged and `docker compose --profile e2e up -d` adds the test pair:

| Service | Host port | Why not the default |
|---|---|---|
| Postgres | **5434** | 5433 is the dev database, and this one gets truncated |
| Redis | **6381** | 6380 is the dev instance |
| API | **4001** | 4000 may be running for development |
| Web | **3001** | 3000 likewise |

All four confirmed free with `docker ps` and `netstat` before this was written,
which CLAUDE.md requires before adding any service.

Playwright's `webServer` starts the API and web against the test database and
waits for readiness. Postgres and Redis come from compose rather than
`webServer`, because Testcontainers-per-run is the option most likely to OOM on
this machine — the failure `pnpm test` already produces.

### Determinism

The suite **truncates and re-seeds before each run**, not between tests.
Per-test reset would triple the runtime, and the two journeys are written to be
independent by construction: each registers its own buyer with a namespaced
email, exactly as the API e2e suite does, and creates its own seller fixture.

The demo market from `seed/demo.ts` supplies the catalogue the buyer journey
searches, so the product page has genuinely competing offers to rank rather
than a single seller.

### The two journeys are S2, as far as Phase 5 reaches

PRD §4.3 S2 is one journey, and it is longer than this codebase:

> browse → search → cart (3 sellers) → checkout → 3 orders → ship → deliver →
> **review → return → refund**

Reviews are Phase 7 and returns and refunds are Phase 8, so S2 cannot be
satisfied today. What CAN be walked is everything up to and including
`deliver`, which is exactly where Phase 5 stopped. This design implements that
prefix and leaves the spec file naming the rest, so the day Phase 8 lands the
missing steps are appended rather than discovered.

Split in two for a practical reason - a failure should say which half broke:

**`journeys/buyer.spec.ts`** — browse, search, open a product page, confirm the
buy box ranks by landed price and names the winning seller, add offers from
**three different sellers** to one cart, check out once with the mock provider,
and land on **three orders**. Three sellers rather than one is not an
embellishment: it is the clause in S2 that makes this a marketplace test rather
than a shop test, and one seller would satisfy the words while proving nothing
about splitting.

**`journeys/fulfilment.spec.ts`** — a seller signs in, accepts one of those
three orders, dispatches part of a line with a carrier and tracking number,
marks it delivered. The buyer reloads and sees the timeline carry the carrier,
the status read `Part shipped` and then `Delivered`, and **the other two orders
untouched** - which is the visible form of the Phase 5 acceptance criterion that
a seller fulfils their own half only.

Between them these cross RLS, the buy box, the ledger, the state machine and
the timeline. **What they deliberately do not do** is re-assert arithmetic the
API suite already proves to the minor unit — an E2E suite that re-tests the
ledger is an E2E suite that breaks whenever the ledger changes, for no
additional information.

**S3, the logistics journey**, is Phase 6 in its entirety - pincode
serviceability, zone rates, slot selection, multi-warehouse allocation, COD
collection. Nothing of it exists to walk. It gets a third spec file when Phase 6
does.

### Browsers

Chromium on every invocation. Firefox and WebKit are a CI-only project in the
Playwright config, selected by an env var the CI job sets. `workers: 1` locally
for the same memory reason; CI may parallelise.

---

## 4. Layer 2 — a11y, inside those journeys

`@axe-core/playwright`, scanning the pages the journeys have already navigated
to. The pages are open; the scan costs one call.

**Gate on `serious` and `critical` only.** A `moderate` rule failing should not
block a ledger fix, and a gate that fires on everything is one that gets
skipped. `minor` and `moderate` findings are reported, not enforced.

Scanned: the product page, the cart, checkout, the buyer's order detail, and
the seller queue. The first four are **buyer-facing**, which is the scope S10
names; the seller queue is included because it is new and cheap to check while
the browser is already there.

This is also where the design direction's claims can finally be checked rather
than asserted: the palette in `DESIGN-DIRECTION.md` claims `muted` is *"AA at
14px on both grounds"*, and until now nothing has verified that.

---

## 5. Layer 3 — visual regression, same runner

`toHaveScreenshot()` on four screens, chosen because each is where the design
carries meaning rather than decoration:

- the **product page buy box**, where alignment does the work colour usually does
- the **order timeline**, where colour is supposed to appear only for delivered
  and cancelled
- the **seller queue**
- the **packing slip**, whose whole point is what it looks like on paper

### Baselines are generated in Linux, always

The trap this design exists to avoid: screenshot baselines are OS-dependent.
Font rasterisation on Windows differs from CI's Linux, so host-generated
baselines would never match and the suite would be red on its first CI run.

Baselines are produced inside the `mcr.microsoft.com/playwright` image **pinned
to the exact version of `@playwright/test` the repo resolves** - the image tag
and the package version must match or the renderer differs and every baseline
is wrong. CI uses the same image. A `pnpm e2e:baseline` script mounts the repo
and regenerates them, so a developer on any OS gets the same bytes.

`maxDiffPixelRatio` is set rather than left at zero: antialiasing differs
between runs of the same renderer, and a suite that fails on three stray pixels
teaches people to regenerate baselines without looking, which defeats the point.

---

## 6. Layer 4 — client components, in `apps/web`

A second Vitest project inside `apps/web`. The existing `node` project keeps
`lib/**` exactly as Phase 5 settled it; a new `jsdom` project covers the client
components.

```ts
// apps/web/vitest.config.ts
projects: [
  { test: { name: 'lib', environment: 'node', include: ['lib/**/*.test.ts', 'app/**/*.test.ts'] } },
  { test: { name: 'components', environment: 'jsdom', include: ['components/**/*.test.tsx'] } },
]
```

**Nine components carry `'use client'`** and are therefore testable this way:
`address-form`, `auth-form`, `cart-line-row`, `checkout-panel`,
`fulfilment-panel`, `offer-table`, `search-field`, `search-sort`,
`theme-toggle`.

Not all nine earn a test on day one. The ones with real behaviour rather than
markup are `fulfilment-panel` (which verbs appear for which status),
`offer-table` (selecting a seller changes the total), `checkout-panel` and
`address-form` (validation and submission states), and `theme-toggle`
(persistence). The rest get tests when they grow logic.

**No snapshots**, for the reason Phase 5 already recorded: a snapshot fails when
a class name changes and passes when the meaning does.

Server actions are mocked at the module boundary — these tests assert what the
component *does with a result*, not that the network works, which is the E2E
suite's job.

---

## 7. Layer 5 — load, in `scripts/load`

k6 through its **Docker image**, so nothing new installs on Windows and CI needs
no toolchain.

### The target is contention, not throughput

"Is the site fast" is not a useful question for a project with no users. The
useful question is whether the concurrency guards hold under real pressure, and
this codebase has two places that matter:

1. **Concurrent checkout on one listing.** ADR 0017 documents a version of the
   stock reservation that let two checkouts take the last unit, and the fix -
   `FOR UPDATE` inside plus the predicate repeated outside - is asserted today
   by exactly two simultaneous requests. Fifty are different.
2. **Concurrent dispatch on one order.** The same shape, guarded differently:
   a row lock rather than a conditional update.

### Thresholds are the gate

- `http_req_failed` under 1 %, excluding the deliberate 409s that ARE the
  correct answer when fifty people want the last unit
- **checkout p95 under 500 ms**, the figure PRD §13 states
- **zero oversells** — a check that counts orders placed against the stock that
  existed. This is the assertion that matters; latency is secondary, and an
  oversell is the failure that costs money rather than patience

The suite runs against the same `e2e` compose profile, seeded fresh, because a
load test against the dev database would be indistinguishable from vandalism.

---

## 8. CI

Two new jobs alongside the three that exist, both required:

```yaml
e2e:     # chromium + firefox + webkit, a11y, visual
load:    # k6 thresholds
```

Both need the compose profile, so both start Postgres and Redis as services.
The existing gate job is unchanged apart from the component tests, which run
inside `pnpm test` and cost seconds.

Playwright's browsers are cached by version key; a cold CI run downloads about
1 GB, a warm one downloads nothing.

---

## 9. What this costs

| | |
|---|---|
| New dependencies | `@playwright/test`, `@axe-core/playwright`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` |
| `pnpm-workspace.yaml` | Playwright needs an `allowBuilds` entry - pnpm 11 blocks its postinstall, and without the browsers every test fails at run time rather than at install |
| Disk | ~1 GB of browsers |
| Local runtime | Chromium-only, two journeys: target under three minutes |
| CI runtime | Three browsers plus load: target under twelve |

---

## 10. Documentation this changes

- **CLAUDE.md** - the commands block gains `pnpm e2e` and `pnpm load`; the
  "four CI gates" line becomes six and says which run where; the `apps/web`
  testing convention is narrowed to say jsdom covers client components and node
  covers everything else; the ports section gains 5434/6381 and says which
  profile owns them.
- **`docs/DESIGN-DIRECTION.md`** - the palette's AA claim stops being a claim,
  because axe now checks it.
- **`apps/e2e/README.md`** - new, describing how to run and how to regenerate
  baselines, since that is the operation people get wrong.

---

## 11. Deliberately deferred

| Not here | Why |
|---|---|
| Broad page smoke tests | Most of the runtime buys assertions that say only "a page rendered" |
| Visual regression on every screen | Four screens where design carries meaning; more is baseline maintenance rather than coverage |
| Cross-browser locally | The RAM is not there. CI has it |
| Load testing search | The search benchmark already exists, measures the right thing, and has its own job |
| S2's review, return and refund steps | Phases 7 and 8. The spec file names them where they will be appended |
| S3, the logistics journey | Phase 6 in its entirety. Nothing of it exists to walk |
| Component tests for all nine | Five have behaviour worth asserting; the rest are markup and get tests when they grow logic |
