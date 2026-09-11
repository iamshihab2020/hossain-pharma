-- Row-level security on `order_item_allocations`.
--
-- The fifth tenant-owned table to take this shape. FORCE is not optional:
-- without it the table owner bypasses every policy, and migrations own it.
--
-- NO BUYER POLICY, and that is the decision rather than an omission. Which of a
-- seller's buildings is holding a buyer's units is warehouse operations, not
-- order history - the buyer's page shows parcels and a timeline, and neither
-- needs an origin. A read policy here would publish one seller's internal stock
-- distribution to every buyer who ordered from them.
--
-- That also means this table needs no gate: with no tenant selected there is no
-- second permissive policy to OR in, which is the bug migrations 0006, 0008,
-- 0012 and 0014 each had to fix. Adding a buyer policy later would reintroduce
-- the risk, and the note above is why it should not be added.

ALTER TABLE "order_item_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_item_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "order_item_allocations"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY platform_admin_bypass ON "order_item_allocations"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
