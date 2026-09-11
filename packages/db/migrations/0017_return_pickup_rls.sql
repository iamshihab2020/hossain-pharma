-- Phase 6 reverse logistics: row-level security on `return_pickups`.
--
-- The fourth table to take this exact shape, and the fifth time the GATE has
-- had to be argued for. FORCE is not optional - without it the table owner
-- bypasses every policy, and migrations own this table.
--
-- NOTE FOR WHOEVER GENERATES 0018: this file was written with
-- `drizzle-kit generate --custom`, which copies the PREVIOUS snapshot rather
-- than snapshotting the current schema. The chain is therefore frozen at 0016
-- again. See the note in CLAUDE.md: keep the next generated migration's
-- snapshot, trim its SQL to the real delta.

ALTER TABLE "return_pickups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_pickups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "return_pickups"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY platform_admin_bypass ON "return_pickups"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- THE GATE, and this time it is load-bearing by itself.
--
-- `own_return_pickups` compares `buyer_user_id` to the user GUC DIRECTLY - no
-- EXISTS, no subquery that RLS would filter on the way past. That makes it the
-- same shape as `own_order_events`, which is the one policy in migration 0014
-- whose mutation check actually went red when the gate was removed. Ungated,
-- this would OR every buyer's pickups into every seller's tenant-scoped read.
--
-- SELECT and INSERT, unlike the Phase 5 buyer policies which are SELECT-only.
-- A buyer BOOKS their own return pickup - that is the whole feature - so unlike
-- a shipment, which is a claim about money, this is a request for a van. The
-- WITH CHECK is what keeps a buyer from booking one in someone else's name, and
-- it repeats the gate so an INSERT cannot slip through while a tenant is set.
CREATE POLICY own_return_pickups ON "return_pickups"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY own_return_pickups_insert ON "return_pickups"
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
