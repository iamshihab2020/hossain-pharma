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
| [0008](./0008-google-oauth-without-passport.md) | Google OAuth without Passport | 1 |
| [0009](./0009-tenant-interceptor-and-capability-enforcement.md) | **The tenant interceptor, and why capabilities are not a guard** | 1 |
| [0010](./0010-seller-onboarding-and-the-approval-queue.md) | Seller onboarding, document storage, and the approval queue | 1 |
| [0011](./0011-user-id-in-tenant-context.md) | `app.user_id` in the tenant context, and the bootstrap policy | 1 |
| [0012](./0012-refresh-token-families.md) | Refresh tokens are families, and are stored as SHA-256 | 1 |
| [0013](./0013-capability-matrix-as-data.md) | The capability matrix is data, and guards never read role names | 1 |
| [0014](./0014-products-listings-and-the-buy-box.md) | **Products, listings, and the buy box** | 2 |
| [0015](./0015-search-materialisation-and-ranking.md) | Search: one materialisation, one predicate, and what the numbers cost | 3 |

**Read 0003 first.** It covers the three separate ways tenant isolation can be
reduced to decoration, each of which fails silently, and where each is checked.
