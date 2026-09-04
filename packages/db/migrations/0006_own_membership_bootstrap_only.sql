-- The `own_membership` policy from 0004 is a BOOTSTRAP policy. Make it act like
-- one.
--
-- Postgres ORs permissive policies. As written in 0004, `own_membership` stayed
-- in force after a tenant was selected, so a tenant-scoped SELECT on org_members
-- returned the active tenant's rows PLUS the caller's own membership rows in
-- every OTHER organisation. The API's tenancy suite caught it: reading
-- /orgs/members with x-tenant-id set to acme-electronics also returned Karim's
-- meridian-fashion and northwind-home rows.
--
-- Nothing leaked to a stranger - a caller can always see their own memberships,
-- which is what the policy is for. What broke is the guarantee the phase
-- actually sells: "a tenant-scoped query returns that tenant's rows". Once one
-- table is allowed to answer with a superset, every consumer has to know which
-- tables have a second permissive policy attached, and that knowledge does not
-- survive contact with a Phase 4 join.
--
-- So the bootstrap policy now applies ONLY while no tenant is selected, which is
-- the exact window it exists for: the API must read org_members to decide which
-- tenant the caller may act as, and that read cannot itself require a tenant.
-- The moment a tenant IS selected, tenant_isolation is the only rule.
--
-- Still FOR SELECT and still no WITH CHECK: enumerate your own memberships,
-- never write one outside a tenant context.

DROP POLICY own_membership ON "org_members";
--> statement-breakpoint

CREATE POLICY own_membership ON "org_members"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
