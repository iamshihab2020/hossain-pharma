# ADR 0009 - The tenant interceptor, and why capabilities are not a guard

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 1
**Amends:** the Phase 1 plan, Task 10 step 6, and migration 0004's
`own_membership` policy.

## Context

PRD 6.4 criterion 1 requires that every request run inside a `withTenant`
transaction. Phase 0 deferred it; Phase 1 Task 10 is where it lands. The plan
specified three globally registered components:

```ts
providers: [
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  { provide: APP_GUARD, useClass: CapabilityGuard },
],
```

with `CapabilityGuard` reading `getRequestContext().roles` - the context the
interceptor establishes. The plan also said, in the same step, to *verify the
execution order with a test rather than assume it*. That instruction earned its
place.

## Decision 1: the capability check runs inside the interceptor

Registered as written, every capability-gated route returned 500:

```
ERROR [ExceptionsHandler] Error: No request context: this code ran outside the TenantInterceptor
    at getRequestContext (src/common/request-context.ts:37:11)
    at CapabilityGuard.canActivate (src/common/guards/capability.guard.ts:26:17)
    at GuardsConsumer.tryActivate (@nestjs/core/guards/guards-consumer.js:15:34)
    at canActivateFn (@nestjs/core/router/router-execution-context.js:146:33)
```

NestJS runs **every guard before any interceptor**. A guard therefore cannot
read state an interceptor produces, whatever order the providers are listed in -
the two are different pipeline stages, not two entries in one list.

So `TenantInterceptor` calls the check itself, immediately after resolving the
caller's roles. `CapabilityGuard` survives as a plain provider holding the
metadata lookup and the decision function, because that is where the decision
belongs and because a function is directly testable.

This is better than the split design, not merely a workaround for it. The roles
that authorise the request are now the same roles the request runs with, read
once, inside the same transaction. The two-component version would have read
membership in the guard and again in the interceptor, with a window in between.

`@RequireCapability('member:write')` is unchanged, which is the part call sites
see.

## Decision 2: membership is read per request, never carried in the token

A tenant-scoped request costs two membership lookups: one with no tenant context
to decide whether the caller may act as the requested tenant, one inside the
scoped transaction to read their roles.

The obvious saving is to put memberships in the access token. Rejected:
revoking someone's membership would then take effect at their next token
refresh rather than immediately, so removing a departing employee's access would
lag by the access-token TTL. An authorisation decision that is stale by design
is the wrong trade against one round trip.

## Decision 3: `own_membership` applies only while no tenant is selected

Migration 0004 added a bootstrap policy so the API could read `org_members`
before any tenant is known - the lookup that decides `tenant_id` cannot itself
require `tenant_id` (plan D-A).

Postgres ORs permissive policies, and as written that policy stayed in force
after a tenant was selected. A tenant-scoped `SELECT` on `org_members` therefore
returned the active tenant's rows **plus the caller's own membership rows in
every other organisation**. The tenancy suite caught it on its first run:
`/orgs/members` with `x-tenant-id` set to acme-electronics also returned Karim's
meridian-fashion and northwind-home rows.

Nothing leaked to a stranger; a caller may always see their own memberships.
What broke is the guarantee the phase sells - "a tenant-scoped query returns
that tenant's rows". Once one table answers with a superset, every consumer has
to know which tables carry a second permissive policy, and that knowledge does
not survive contact with a Phase 4 join.

Migration 0006 gates the policy on there being no tenant selected, which is the
exact window it exists for. It is still `FOR SELECT` with no `WITH CHECK`.

Note what found this: an application-level `WHERE tenant_id = ...` in
`OrgsService.listMembers` would have hidden it completely. The service
deliberately does not filter, so the test is testing RLS rather than testing a
filter.

## Consequences

- A controller with no decorators is authenticated and tenant-scoped. Opting out
  is `@Public()`, and there is no "skip the interceptor but keep the guard"
  state - see plan D-E.
- The tenant arrives as `x-tenant-id`. A malformed value is a 400 rather than a
  500: `set_config` accepts any string and the policy's `NULLIF(...)::uuid` cast
  then raises inside the query.
- A caller presenting a tenant they do not belong to gets **403**, never an
  empty 200. A silent downgrade to "no tenant" renders as an ordinary empty list
  and hides the authorisation failure.
- A platform `ADMIN` passes every capability check, and `platform_admin_bypass`
  gives them the rows. Both are needed and they are not the same mechanism.
- The seed now gives Karim OWNER in a second organisation. The cross-tenant
  concurrency proof needs one caller holding one capability in two tenants; the
  only other candidate is a platform admin, whose bypass policy would make the
  test vacuous.
- Services take their transaction from `getRequestContext()`, which throws
  outside a request rather than falling back to a raw connection.

## Related

- `apps/api/src/common/` - interceptor, guards, request context, decorators
- `apps/api/test/tenancy.e2e.test.ts` - PRD 6.4 criteria 1, 3 and 4
- `packages/db/migrations/0006_own_membership_bootstrap_only.sql`
- ADR 0003 - RLS, the app role and pooling
- PRD 5.1, 5.3, 6.4, 13
