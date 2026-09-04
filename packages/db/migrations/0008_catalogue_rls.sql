-- Phase 2 catalogue: row-level security, constraints and indexes drizzle-kit
-- cannot express.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables. ENABLE alone is decoration.

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "listings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- NULLIF(..., '') is load-bearing on every one of these. withTenant writes an
-- empty string for a null tenant, and ''::uuid raises "invalid input syntax for
-- type uuid". NULLIF turns it back into NULL, and `tenant_id = NULL` is NULL
-- rather than TRUE, so an unset context yields ZERO rows. PRD 6.4 criterion 4.
CREATE POLICY tenant_isolation ON "warehouses"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "warehouses"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "listings"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "listings"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- THE ONE DELIBERATE PUBLIC READ IN THE SYSTEM, and it needs its reasons in
-- writing because it is the shape that looks like a mistake.
--
-- A marketplace product page shows every seller's offer to an anonymous
-- visitor. That read runs with NO tenant context, and under tenant_isolation
-- alone it returns zero rows - correctly, and uselessly.
--
-- THE `tenant_id IS NULL` GATE IS NOT DECORATION. Postgres ORs permissive
-- policies, so without it a seller reading their own listings with a tenant
-- selected would ALSO match this policy and see every other seller's ACTIVE
-- offers mixed into their own catalogue. That is exactly the bug migration 0006
-- fixed on org_members, found by a test rather than by review, and it is the
-- default outcome of adding a second permissive policy to a tenant-owned table.
--
-- So: this policy is live only while NO tenant is selected. With a tenant, the
-- only rule is tenant_isolation.
--
-- FOR SELECT only, and restricted to status = 'ACTIVE'. A DRAFT price, a PAUSED
-- offer and an ARCHIVED one stay invisible to everyone except their own tenant
-- and the platform admin. There is no WITH CHECK, so this can never authorise a
-- write.
--
-- Note what is NOT public: inventory_items. Exact per-warehouse stock is a
-- competitor's business intelligence. The buy box reads listings.available_stock
-- instead, a sum maintained by the one service that owns those rows.
CREATE POLICY public_active_offers ON "listings"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND status = 'ACTIVE'
  );
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "inventory_items"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "inventory_items"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- categories, category_attributes, products, product_variants, product_media
-- and product_attributes carry NO policy and NO row-level security, and that is
-- a decision rather than an omission (PRD 6.2, 8.3). A catalogue entry is
-- shared by competing sellers; a tenant policy on `products` would make the
-- one-product-many-sellers page impossible, which is the entire point of the
-- phase. Writes are guarded at the API by @PlatformAdmin(). Do not "fix" this.

-- Three levels, per PRD 8.1 and 9.1's breadcrumb behaviour. A property of the
-- data, so it is enforced where the data lives.
ALTER TABLE "categories"
  ADD CONSTRAINT categories_max_depth CHECK (nlevel(path) <= 3);
--> statement-breakpoint

-- Exactly one value column set. Without this, a row with every column null is a
-- valid attribute that silently means nothing, and a row with two is ambiguous
-- to every reader.
ALTER TABLE "product_attributes"
  ADD CONSTRAINT product_attributes_one_value CHECK (
    (value_text IS NOT NULL)::int + (value_number IS NOT NULL)::int + (value_bool IS NOT NULL)::int = 1
  );
--> statement-breakpoint

-- Stock cannot be negative, and reservations cannot exceed what is on hand.
-- Phase 4 decrements `reserved` at checkout, and this is what stops a race there
-- from producing a listing that owes stock it does not have.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT inventory_items_non_negative CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand);
--> statement-breakpoint

ALTER TABLE "listings"
  ADD CONSTRAINT listings_available_stock_non_negative CHECK (available_stock >= 0);
--> statement-breakpoint

-- Prices are integer minor units and a negative one is not a discount. A sale
-- price above the base price is not a sale.
ALTER TABLE "listings"
  ADD CONSTRAINT listings_prices_non_negative CHECK (
    price_amount >= 0
    AND shipping_amount >= 0
    AND (sale_price_amount IS NULL OR (sale_price_amount >= 0 AND sale_price_amount <= price_amount))
  );
--> statement-breakpoint

-- GiST is what makes `path <@ 'electronics'` a subtree lookup rather than a
-- sequential scan. drizzle-kit cannot express an operator class, so it lives
-- here.
CREATE INDEX categories_path_gist_idx ON "categories" USING gist (path);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "category_attributes" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_variants" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_media" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_attributes" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "warehouses" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "listings" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_items" TO nexmarket_app;
