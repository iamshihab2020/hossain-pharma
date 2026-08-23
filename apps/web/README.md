# @nexmarket/web

Next.js 16 App Router, server-first. Tailwind 3.4 with shadcn/ui primitives.

## Layout

```
app/
├── layout.tsx             root layout, imports globals.css
├── page.tsx               placeholder landing (Phase 2 replaces it)
├── globals.css            re-exports the shared theme tokens
├── (shop)/                buyer storefront          (Phase 2)
├── (account)/             buyer account             (Phase 4)
├── (seller)/              seller console, tenant-scoped (Phase 10)
└── (admin)/               platform admin            (Phase 11)

components/
├── ui/                    32 vendored shadcn/ui primitives (PRD 12.1)
└── ...                    everything we write lives outside ui/

lib/utils.ts               cn() class merge helper
hooks/                     shared client hooks
```

## Conventions

**Server components by default.** A `'use client'` directive is a deliberate
choice for interactivity, never a default. The archived rewrite made every page
a client component and fetched nothing on the server; inverting that is the
point of this build (PRD 12.1).

**The browser never calls the API directly.** Requests originate server-side
from a React Server Component or Server Action, so the access token lives in an
`httpOnly` cookie and never reaches JavaScript. That closes the `localStorage`
XSS exposure the legacy client had.

**`components/ui/` is vendored.** Those files come from shadcn/ui and are
regenerable by its CLI, so lint opinions are relaxed there (see
`eslint.config.js`) while type-checking still applies. Anything we author lives
outside that directory.

**Theme tokens are shared.** Colours resolve through `hsl(var(--token))` from
`@nexmarket/config/tailwind/globals.css`, paired with the preset in
`tailwind.config.ts`. Both travel together: a token with no matching CSS
variable renders as a broken colour and is invisible to type-check.

## Pinned versions, and why

| Package | Pin | Reason |
|---|---|---|
| `tailwindcss` | 3.4.x | The salvaged primitives and `globals.css` are v3 format. Tailwind 4 is CSS-first (`@theme`) and converting both is a deliberate later task. |
| `react-day-picker` | 9.11.x | v10 changed the `ClassNames` API that the salvaged `calendar.tsx` targets. |

`exactOptionalPropertyTypes` is off for the frontend only
(`@nexmarket/config/tsconfig/nextjs.json`): shadcn's own source does not compile
under it, and regenerating any primitive would reintroduce the errors. Backend
packages, whose code we own, keep it on.

## Before writing App Router code

**Next 16 has breaking changes from 15**, and the PRD was written against 15.
Next ships its own docs locally at `node_modules/next/dist/docs/` (resolve from
this directory, not the repo root - pnpm does not hoist `next`). Read the
relevant guide there before writing routing, caching, or data-fetching code
rather than relying on Next 15 habits.

`AGENTS.md` and `CLAUDE.md` in this directory are generated and re-added by
`next dev`. They are committed on purpose: deleting them only recreates an
uncommitted change.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | dev server on port 3000 |
| `pnpm build` | production build |
| `pnpm lint` | eslint over `app`, `components`, `lib` |
| `pnpm type-check` | `tsc --noEmit` |
