-- Phase 5 fulfilment: row-level security, the append-only event log, and the
-- over-shipment invariant. None of this is expressible in a schema diff, which
-- is why `db:push` runs migrations rather than `drizzle-kit push`.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables. ENABLE alone is decoration.

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipment_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- SHIPMENTS ------------------------------------------------------------------

CREATE POLICY tenant_isolation ON "shipments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "shipments"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- THE GATE, for the fourth time in this codebase.
--
-- Postgres ORs permissive policies, so an ungated buyer policy widens every
-- tenant-scoped read - the bug migration 0006 fixed on org_members, 0008 on
-- listings and 0012 on orders.
--
-- WHAT THE MUTATION CHECK ACTUALLY SHOWED, because the honest answer is more
-- useful than the tidy one: deleting the gate here does NOT turn the test red.
-- This policy's EXISTS reads `orders`, and that subquery runs under RLS too, so
-- with a tenant selected it only ever sees that tenant's order and another
-- seller's parcel fails the EXISTS anyway. Same for own_shipment_items, which
-- nests one level deeper. Only own_order_events - a direct column comparison
-- with no subquery to be filtered - widens to 2 when its gate is removed.
--
-- The gate stays on all three regardless. The protection those two currently
-- enjoy is DERIVED from the orders policy rather than stated here, and a policy
-- that is only safe because of a different table's policy is one refactor away
-- from not being safe at all.
--
-- FOR SELECT with no WITH CHECK, deliberately. A buyer READS parcels; a buyer
-- must never insert one. Since dispatch releases a seller's payable, an inserted
-- shipment is a claim about money, not just about a box.
CREATE POLICY own_shipments ON "shipments"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = shipments.order_id
        AND o.buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
--> statement-breakpoint

-- SHIPMENT ITEMS -------------------------------------------------------------

CREATE POLICY tenant_isolation ON "shipment_items"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "shipment_items"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- Same gate, same reasons, joined through the shipment to the order.
CREATE POLICY own_shipment_items ON "shipment_items"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1 FROM shipments s
      JOIN orders o ON o.id = s.order_id
      WHERE s.id = shipment_items.shipment_id
        AND o.buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
--> statement-breakpoint

-- ORDER EVENTS ---------------------------------------------------------------

CREATE POLICY tenant_isolation ON "order_events"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "order_events"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- Same gate. A DIRECT column comparison rather than the EXISTS the other two
-- use, because buyer_user_id is denormalised onto this table: the timeline is
-- read on every render of the buyer's most-visited authenticated page, and a
-- two-level EXISTS on that path buys nothing.
CREATE POLICY own_order_events ON "order_events"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint

-- APPEND-ONLY, AND WHY IT IS A REVOKE ----------------------------------------
--
-- Migration 0001 ran
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
--
-- so order_events ALREADY carries all four privileges before this file runs. A
-- narrower `GRANT SELECT, INSERT` would be purely additive: it reads like a
-- restriction and removes nothing. That was verified against a live database
-- when the first version of migration 0012 made exactly this mistake on
-- ledger_entries.
--
-- A timeline that can be edited is not a timeline. The tests assert SQLSTATE
-- 42501 on both verbs, because a comment claiming immutability over a role that
-- can UPDATE is worse than neither.
REVOKE UPDATE, DELETE ON "order_events" FROM nexmarket_app;--> statement-breakpoint

-- THE OVER-SHIPMENT INVARIANT ------------------------------------------------
--
-- shipped + cancelled <= ordered, per order item.
--
-- Not a CHECK: the invariant spans rows in another table. DEFERRABLE INITIALLY
-- DEFERRED, because a multi-line shipment is legitimately mid-flight between
-- statements - the same reason the ledger balance trigger is deferred, and a
-- non-deferred version would reject the second insert of a two-line parcel.
--
-- This does NOT reopen Phase 3's rejection of triggers for the search index.
-- That rejection stands, and the distinction is assertion versus side effect: a
-- search trigger would have WRITTEN DATA invisibly from the call site, whereas
-- this one writes nothing and can only refuse. FulfilmentService still checks
-- first, with the conditional-UPDATE shape from ADR 0017 decision 4. This is
-- the backstop, because "the service always checks" is a claim no test can make
-- about a service that has not been written yet.
CREATE OR REPLACE FUNCTION assert_within_ordered() RETURNS trigger AS $$
DECLARE
  target_item uuid;
  ordered_qty integer;
  cancelled_qty integer;
  shipped_qty integer;
BEGIN
  -- One function, two triggers: a new shipment line, or a line being cancelled.
  --
  -- IF/ELSE rather than a CASE expression, and that is load-bearing. PL/pgSQL
  -- prepares a CASE as ONE SQL expression, so BOTH field references are
  -- resolved when it is planned - and order_items has no order_item_id column,
  -- so the whole trigger died with 42703 whichever table fired it. Separate
  -- statements are planned separately, and only the taken branch runs.
  IF TG_TABLE_NAME = 'shipment_items' THEN
    target_item := NEW.order_item_id;
  ELSE
    target_item := NEW.id;
  END IF;

  SELECT oi.quantity, oi.cancelled_quantity
    INTO ordered_qty, cancelled_qty
    FROM order_items oi
   WHERE oi.id = target_item;

  -- The row can legitimately be gone by commit: order_items cascades from
  -- orders. Nothing to assert about a line that no longer exists.
  IF ordered_qty IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(si.quantity), 0)
    INTO shipped_qty
    FROM shipment_items si
   WHERE si.order_item_id = target_item;

  IF shipped_qty + cancelled_qty > ordered_qty THEN
    RAISE EXCEPTION
      'Order item % over-ships: % shipped + % cancelled exceeds % ordered',
      target_item, shipped_qty, cancelled_qty, ordered_qty;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER shipment_items_within_ordered
  AFTER INSERT OR UPDATE ON "shipment_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_within_ordered();--> statement-breakpoint

-- The other direction: cancelling units that a courier already has.
CREATE CONSTRAINT TRIGGER order_items_within_ordered
  AFTER UPDATE OF cancelled_quantity ON "order_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_within_ordered();
