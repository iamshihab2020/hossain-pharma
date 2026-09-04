# ADR 0010 - Seller onboarding, document storage, and the approval queue

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 1
**Implements:** plan decision D-D; PRD 9.2, 9.3, 6.6, 13.

## Context

Phase 1 has to take a seller from "I have an account" to "I am an approved
tenant": create an organisation, attach KYC documents, submit, and have a
platform admin approve or reject it. PRD 4.2 lists real KYC as a non-goal, and
object storage is a PRD 10.5 concern with no adapter yet.

## Decision 1: a `FileStorage` port, with a local adapter

`put(bytes, meta) -> { storageKey }` and `get(storageKey) -> Buffer`. Phase 1
ships `LocalFileStorage`, which writes under `FILE_STORAGE_DIR`. Object storage,
signed URLs and virus scanning replace the adapter and nothing else.

**The storage key contains no part of the caller's filename** - it is
`<tenantId>/<uuid>`. A user-supplied filename in a filesystem path is a
traversal bug, and `../../../etc/passwd` is a legal value for that field. The
name survives as data in `seller_documents.original_filename`, where it is never
a path. `get` additionally resolves and checks containment, because it reads
whatever is in the column rather than a key it just minted.

`storageKey` never appears in a response body. A client that cannot see it
cannot build a URL out of it, which is the property the signed-URL work will
depend on.

## Decision 2: documents arrive as base64 in JSON, not multipart

A deliberate boundary. What Phase 1 must get right is the port and the fact that
a document is tenant-owned and RLS-scoped; the transport changes without
touching either, and adding a multipart parser now would be a dependency
carrying no test that could fail.

The costs are stated rather than hidden: ~33% encoding overhead, the whole body
is buffered, and Fastify's 1 MiB default body limit had to be raised. That last
one moved adapter construction into `createAdapter()` in `configure-app.ts`,
because `bodyLimit` is a constructor option - a second `new FastifyAdapter()`
anywhere would silently revert to 1 MiB and produce a 413 no test reproduces.
The real per-document limit is enforced on the **decoded** bytes in the service.

`Buffer.from(x, 'base64')` silently drops what it cannot decode, so an explicit
zero-length check stands between a garbage body and a stored empty file
returning 201.

## Decision 3: the founding OWNER is written under a scoped elevation

`POST /orgs` runs with **no** tenant context - the organisation being created
cannot be the active tenant, because it does not exist when the interceptor
runs. But `org_members` is tenant-isolated with FORCE, so the founding OWNER row
needs `app.tenant_id` set to the new organisation.

`OrgsService.claimFoundingOwner` therefore moves the context for exactly one
insert and moves it back, both with `set_config(..., true)`. It is
transaction-local both times, so nothing escapes onto the pooled connection, and
it is atomic with the `INSERT INTO organisations` above it - a failure leaves no
ownerless organisation behind.

**This is the only place outside `withTenant` that writes `app.tenant_id`**, and
it is safe only because the tenant it moves to is one the same transaction just
created. There is no caller-supplied value anywhere in it. The alternatives were
worse: a second transaction is not atomic, and a database policy permitting
"claim an ownerless org" cannot be written correctly, because the `NOT EXISTS`
subquery it needs is itself subject to RLS and would read as vacuously true.

## Decision 4: cursor pagination, encoding `(createdAt, id)`

PRD 13 makes this mandatory on every collection endpoint and the approval queue
is the first one, so it sets the shape.

An offset drifts the moment a row is inserted ahead of the reader - and the
approval queue is precisely a list that grows while it is read, so page 2 would
repeat one row and eventually hide another. The id breaks ties, because two
organisations created in the same millisecond are ordinary.

An oversized `limit` is **rejected, not clamped**. Clamping looks friendlier and
is worse: the caller asked for 5000, got 100, and their "have I reached the
end?" test is now true on the first page.

`limit + 1` rows answer "is there more?" without a `COUNT` that would be both
slower and stale by the time it returned.

The cursor is base64 for URL-safety only. It is not a secret and not
tamper-proof: editing it yields a different page of rows the caller could
already see, because RLS and the guards run regardless of where a page starts.

## Decision 5: `@PlatformAdmin()` is a guard, unlike `@RequireCapability`

`platform_role` is a claim in the access token, which `AuthGuard` has already
attached to the request, so `AdminGuard` reads the request rather than the
interceptor's context - and guards can do that. It is registered **after**
`AuthGuard` in `app.module.ts`; guards run in registration order, and before it
the guard would see `undefined` and refuse every admin. ADR 0009 covers why the
capability check could not take this shape.

Admin-only is not modelled as a capability because capabilities are
organisation-scoped, and the approval queue is not inside any organisation.
Expressing it as one would mean inventing an organisation for the platform,
which is the modelling mistake PRD 6.1 avoids.

## Decision 6: the PRD 6.6 state machine is a table

`ALLOWED_TRANSITIONS` in `modules/orgs/lifecycle.ts` is the only place the rule
lives; anything absent from it is a 409. `assertTransition` throws rather than
returning false, because every caller would otherwise write the same three lines
and one of them would eventually write two.

`AdminService.transition` is one write path for all four admin actions, so the
audit fields cannot be set on three routes and forgotten on the fourth. It reads
`FOR UPDATE` inside the interceptor's transaction, so two reviewers cannot both
act from the same starting state.

**SUSPENDED withdraws selling, not fulfilment.** `product:write`,
`settings:write`, `payout:write` and `member:write` leave the effective set; a
suspended organisation still resolves as a tenant. Phase 1 has no orders, so the
test asserts the mechanism rather than the outcome and its name says so.
`CLOSED` is terminal and does not resolve as a tenant at all.

## What this cost, and what it caught

**A correlated subquery that silently counted zero.** The queue originally
computed `documentCount` with

```ts
sql`(SELECT count(*)::int FROM ${schema.sellerDocuments}
     WHERE ${schema.sellerDocuments.tenantId} = ${schema.organisations.id})`
```

Drizzle renders column references inside a raw `sql` template in the SELECT list
**without table qualification**, so this became `WHERE "tenant_id" = "id"` -
`seller_documents` compared to itself, always false, no error, every row
reporting zero documents. It looked exactly like an RLS failure and was not;
`SELECT current_setting('app.is_admin')` and a plain count in the same
transaction are what separated the two.

It is now a second query over the page's ids, bounded by `MAX_LIMIT`. One extra
round trip is a cheap price for a query whose correctness does not depend on how
an ORM renders an identifier.

**Test emails must be namespaced per file.** Vitest runs test files in parallel
against the single database this suite starts, and `users.email` is globally
unique, so the same address in two files is a 409 for whichever loses the race -
green in a single-file run, red in the suite.

## Related

- `apps/api/src/modules/orgs/`, `apps/api/src/modules/admin/`,
  `apps/api/src/common/pagination.ts`
- `apps/api/test/onboarding.e2e.test.ts`, `apps/api/test/admin-approval.e2e.test.ts`
- ADR 0009 - the interceptor and the guard-ordering constraint
- PRD 6.6 (lifecycle), 9.2 (onboarding), 9.3 (governance), 13 (pagination, KYC)
