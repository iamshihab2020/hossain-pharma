# Architecture Decision Records

One record per decision that would otherwise have to be re-derived from the code.
Each states the context, the decision, and what it costs.

| # | Decision | Phase |
|---|---|---|
| [0001](./0001-monorepo-and-stack.md) | Monorepo layout and stack, with resolved versions and why TypeScript is pinned | 0 |
| [0002](./0002-drizzle-over-prisma.md) | Drizzle over Prisma | 0 |
| [0003](./0003-rls-app-role-and-pooling.md) | **RLS: the app role, FORCE, and the pooling hazard** | 0 |
| [0004](./0004-local-docker-vs-neon.md) | Local Docker for development, Neon for deployment | 0 |
| [0005](./0005-esm-and-the-driver-constraint.md) | ESM everywhere, and the interactive-transaction constraint | 0 |
| [0006](./0006-frontend-salvage-and-pins.md) | Frontend salvage, and two version pins | 0 |
| [0007](./0007-db-push-runs-migrations.md) | `pnpm db:push` runs migrations | 0 |

**Read 0003 first.** It covers the three separate ways tenant isolation can be
reduced to decoration, each of which fails silently, and where each is checked.
