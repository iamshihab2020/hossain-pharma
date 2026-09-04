-- PRD 6.3 and 6.4. Hand-written because drizzle-kit cannot express RLS.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables. ENABLE alone is decoration.

ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seller_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seller_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- NULLIF(..., '') is load-bearing. withTenant writes an empty string for a null
-- tenant, and ''::uuid raises "invalid input syntax for type uuid". NULLIF turns
-- it back into NULL, and `tenant_id = NULL` is NULL rather than TRUE, so an
-- unset context yields ZERO rows. PRD 6.4 criterion 4: fail closed, never open.
CREATE POLICY tenant_isolation ON "org_members"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- The bootstrap policy. See the Phase 1 plan, decision D-A.
--
-- To decide WHICH tenant a caller may act as, the API must read org_members
-- BEFORE any tenant is known. Under tenant_isolation alone that read returns
-- zero rows and every user appears to belong to no organisation.
--
-- FOR SELECT only, and deliberately no WITH CHECK: a user may enumerate their
-- own memberships and may never write one outside a tenant context.
-- Self-granting a membership is the obvious attack; this closes it in the
-- database rather than in a service method someone can forget to call.
--
-- Postgres ORs permissive policies, so a row is visible when it belongs to the
-- active tenant OR to the calling user.
CREATE POLICY own_membership ON "org_members"
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY platform_admin_bypass ON "org_members"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "seller_documents"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- Admins review documents across every tenant. That IS the approval queue.
CREATE POLICY platform_admin_bypass ON "seller_documents"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- 0001 granted on ALL TABLES as of that moment, plus DEFAULT PRIVILEGES for
-- tables created later BY THE SAME ROLE. Re-granting explicitly is cheap and
-- removes the dependency on that assumption holding.
GRANT SELECT, INSERT, UPDATE, DELETE ON "org_members" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "seller_documents" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_identities" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO nexmarket_app;
