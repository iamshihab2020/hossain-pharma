# ADR 0006 - Frontend salvage, and two version pins

**Status:** accepted
**Date:** 2026-08-23
**Phase:** 0

## Context

An earlier Next.js 15 rewrite exists in `archive/frontend/` - roughly 15k lines
across 109 `.tsx` files. It **does not build**: two pages resolve to `/`, the
homepage runs on 990 lines of mock data, every page is `'use client'`, and
`node_modules` had never been installed, so `next build` had never run on that
branch.

PRD 12.1 rules on what survives.

## Decision

### Salvaged

- **32 shadcn/ui primitives** from `components/ui/`.
  `product-card-enhanced.tsx` was dropped: it is one of three duplicated
  component pairs where only the non-enhanced half was wired.
- **`lib/utils.ts`** - the `cn()` class-merge helper.
- **Tailwind theme tokens and CSS variables** into `packages/config`, so the API
  docs surface and any future admin app share one palette.
- **`components.json`**, with the `hooks` alias corrected from `@/lib/hooks`,
  which pointed at a directory that did not exist.

Dependencies were determined by **grepping the primitives' actual imports**, not
by copying the archive's manifest - that manifest also lists packages only the
deleted pages used (Firebase, Stripe, Zustand, axios, NextAuth).

Two theme tokens were dropped: `trust` and `health`, from a block commented
`// Healthcare-specific colors`. PRD v2.0 removed the pharmacy framing entirely.
`success`, `warning` and `danger` stay as generic status semantics, and
`verified` stays because it maps to the verified-seller badge in PRD 9.2, which
is a marketplace concept.

### Not salvaged

All pages, all `lib/api/*` (they wrap the Mongo-shaped API being retired), all
Zustand stores (state moves server-side), `lib/mock-data/`, `lib/firebase/`, and
every `components/pages/home/*` section.

## The two pins

Both exist because the salvaged assets predate a breaking change.

### `tailwindcss` 3.4.17

`pnpm add tailwindcss` resolves 4.3.3. Tailwind 4 is CSS-first: `@theme` blocks
in CSS, no `tailwind.config.ts`, no `presets`. The 32 primitives and the salvaged
`globals.css` are both v3 format, so adopting v4 would mean rewriting the very
assets PRD 12.1 says to salvage.

A Tailwind 4 migration is a deliberate task with its own before/after, not
something to absorb during a foundation phase.

### `react-day-picker` 9.11.2

Resolves to 10.0.1, which changed the `ClassNames` API. The salvaged
`calendar.tsx` passes a `table` key that v10 rejects. The archive used `^9.11.2`.

## Related relaxations

**`exactOptionalPropertyTypes` is off for the frontend only**
(`packages/config/tsconfig/nextjs.json`). shadcn/ui source passes
`foo={maybeUndefined}` into required-optional props and does not compile under
it, and regenerating any primitive via the shadcn CLI would reintroduce the
errors. Backend packages, whose code we own, keep it on.

**`components/ui/**` has relaxed lint rules, not relaxed type-checking.**
Vendored, regenerable upstream code; lint opinions there are noise. Anything we
author lives outside that directory.

## Note for later phases

Next resolved to **16.3.2**, not the 15 the PRD names. 16 satisfies the floor and
builds clean, but it has breaking changes from 15 and ships its own docs at
`apps/web/node_modules/next/dist/docs/`. Read those before writing routing,
caching or data-fetching code rather than relying on Next 15 habits.

`apps/web/AGENTS.md` and `CLAUDE.md` are generated and re-added by `next dev`;
they are committed deliberately, since deleting them only recreates an
uncommitted change.
