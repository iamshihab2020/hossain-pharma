-- PRD section 6.3. Hand-written because drizzle-kit cannot express RLS:
-- `push` diffs schema and has no notion of CREATE POLICY or role grants.
--
-- FORCE ROW LEVEL SECURITY is not optional. Without it the table OWNER bypasses
-- every policy on the table. That is how a project ends up with a hundred
-- policy-bearing tables and zero actual enforcement.

ALTER TABLE "rls_probe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rls_probe" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Reads and writes are confined to the tenant in transaction-local context.
--
-- current_setting(..., true) returns NULL rather than erroring when the setting
-- is unset, and `tenant_id = NULL` evaluates to NULL, which is not TRUE, so an
-- unset context yields ZERO rows. That is the required behaviour: PRD 6.4
-- criterion 4 says missing context must fail closed, never open.
--
-- NULLIF(..., '') matters. withTenant writes an empty string when tenantId is
-- null, and ''::uuid raises "invalid input syntax for type uuid". NULLIF turns
-- it back into NULL so the comparison fails closed instead of throwing.
CREATE POLICY tenant_isolation ON "rls_probe"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY platform_admin_bypass ON "rls_probe"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- The app role must reach tables created by the migration role.
--
-- Deliberately self-contained rather than relying on docker/postgres-init:
-- the Testcontainers suites migrate against a fresh container that never sees
-- that script, and Neon is provisioned by hand. Without the schema grant those
-- suites fail with "permission denied for schema public" and look like an RLS
-- failure when they are nothing of the kind.
GRANT USAGE ON SCHEMA public TO hossain_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hossain_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hossain_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hossain_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hossain_app;
