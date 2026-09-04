# ADR 0011 - `app.user_id` in the tenant context, and the bootstrap policy

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 1
**Implements:** plan decision D-A. **Amended by:** migration 0006 (see ADR 0009).

## Context

PRD 5.1 says one human can own one seller organisation, work as staff in
another, and shop as a buyer, all at once. The API therefore has to answer
"which organisations may this caller act as?" on every request that selects a
tenant.

That answer lives in `org_members`, which is tenant-owned and RLS-isolated. And
there is the circularity: **the lookup that decides `tenant_id` cannot itself
require `tenant_id`.** Under `tenant_isolation` alone, a read with no tenant
context returns zero rows, so every user appears to belong to no organisation
and nobody can ever select a tenant.

## Decision

`TenantContext` carries a third value, and `withTenant` sets a third GUC:

```ts
export type TenantContext = {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly isAdmin: boolean;
};
```

```sql
SELECT set_config('app.tenant_id', $1, true);
SELECT set_config('app.user_id',   $2, true);
SELECT set_config('app.is_admin',  $3, true);
```

`userId` is **required, not optional**, so every call site has to decide rather
than inherit a default. All three are `set_config(..., true)` - transaction
local, discarded at COMMIT, never left on the pooled connection.

`org_members` gains a second permissive policy:

```sql
CREATE POLICY own_membership ON "org_members"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
```

**`FOR SELECT`, and deliberately no `WITH CHECK`.** A user may enumerate their
own memberships and may never write one outside a tenant context. Self-granting
a membership - `INSERT INTO org_members (tenant_id, user_id, role) VALUES
(<any org>, me, 'OWNER')` - is the obvious attack, and it is closed in the
database rather than in a service method someone can forget to call. There is a
test that performs exactly that insert and asserts SQLSTATE 42501.

The `tenant_id IS NULL` clause came later, in migration 0006. Without it the
policy stayed in force after a tenant was selected, and permissive policies are
ORed, so a tenant-scoped read returned the caller's rows from every other
organisation too. ADR 0009 has the detail. The policy is what it says it is: a
**bootstrap** policy, live only in the window before a tenant exists.

## Alternatives rejected

**1. Read memberships on a connection that bypasses RLS.** A second pool as a
`BYPASSRLS` role, used only for this lookup. Rejected: it puts a
policy-bypassing connection into the request path, which is exactly what PRD 6.3
and ADR 0003 exist to prevent. The first time someone reuses that handle for
"just one more query", isolation is gone with nothing failing.

**2. Put memberships in the access token.** No lookup at all - the claim is
already there. Rejected: revoking someone's membership would then take effect at
their next token refresh rather than immediately, so removing a departing
employee's access lags by the access-token TTL. An authorisation decision that
is stale by design is the wrong trade against one round trip. This is also why
`AccessTokenPayload` carries no tenant, no org and no capability list.

**3. Application-level `WHERE user_id = $1` with RLS off `org_members`.**
Rejected: it makes the isolation of a tenant-owned table depend on every query
remembering a filter, which is the model PRD 6.4 replaced.

## Consequences

- A tenant-scoped request costs two lookups: one with no tenant to authorise the
  header, one inside the scoped transaction. Accepted, for the reason in
  alternative 2.
- **The seed had to change shape.** `org_members` inserts run through
  `withTenant`, because the seed connects as `nexmarket_app` (NOBYPASSRLS) and a
  plain `db.insert(orgMembers)` writes **zero rows and throws nothing** - the
  `WITH CHECK` silently rejects every row whose tenant it cannot attribute. The
  seed reports success against an empty table. Running that part of the seed on
  the owner connection was rejected: it would mean the seed never exercises the
  policies, so a broken policy would show up in production rather than here.
- `tenant-context.ts` stays at 100% coverage, including the third GUC.

## Related

- `packages/db/src/tenant-context.ts`, `packages/db/src/seed/org-members.ts`
- `packages/db/migrations/0004_membership_rls.sql`, `0006_own_membership_bootstrap_only.sql`
- `packages/db/src/membership-rls.test.ts`
- ADR 0003 (RLS, the app role, pooling), ADR 0009 (the interceptor)
