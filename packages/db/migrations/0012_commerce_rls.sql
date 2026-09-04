-- Phase 4 commerce: row-level security, the ledger balance invariant, and the
-- grants that make the ledger append-only. None of this is expressible in a
-- schema diff.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables. ENABLE alone is decoration.

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "orders"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "orders"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- THE BUYER'S VIEW OF THEIR OWN ORDERS, and the third use of a pattern this
-- codebase has now been bitten by twice.
--
-- A buyer must see THEIR orders across every seller. A buyer is not a tenant
-- (PRD 6.2), so their requests carry no app.tenant_id, and under
-- tenant_isolation alone they would see nothing.
--
-- THE `IS NULL` GATE IS NOT DECORATION. Postgres ORs permissive policies, so
-- without it a seller reading their own orders with a tenant selected would
-- ALSO match this policy - and see every order placed by any user who happens
-- to share their user id, which after admin impersonation (Phase 11) is not
-- hypothetical. Migration 0006 fixed exactly this on org_members and 0008 on
-- listings. Assume any third policy has the bug until a test says otherwise;
-- orders-rls.test.ts is that test, and it is mutation-verified by deleting
-- this line and watching the seller-isolation case fail.
--
-- app.user_id exists for this class of question - "who is the caller,
-- independent of any tenant?" - and was introduced in ADR 0011 for the
-- membership bootstrap. This is its second reader.
--
-- FOR SELECT only, and no WITH CHECK: a buyer must never be able to insert an
-- order attributed to themselves outside checkout.
CREATE POLICY own_orders ON "orders"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "order_items"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "order_items"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');
--> statement-breakpoint

-- Same gate, same reasons, joined through the order the item belongs to.
CREATE POLICY own_order_items ON "order_items"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
--> statement-breakpoint

-- carts, cart_items, addresses, payment_intents, payment_events, transactions,
-- ledger_accounts and ledger_entries carry NO row-level security, and that is a
-- decision rather than an omission.
--
-- A cart spans sellers by definition, so there is no tenant to scope it to. The
-- ledger is the PLATFORM's books: one capture posts entries against two
-- sellers' payable accounts and the platform's revenue account in a single
-- transaction, which under a tenant GUC is impossible - whichever tenant is
-- selected, the other sellers' rows fail WITH CHECK. Making it work would need
-- a third tenant-scope escape hatch, and common/tenant-scope.ts says to stop
-- and ask first. The answer is that this is not tenant-scoped work.
--
-- The boundary on all of them is therefore a user_id or owner_org_id filter in
-- the service, which means the filter appears in every method rather than in a
-- helper somebody could forget, and there are tests that one user cannot read
-- another's cart and one seller cannot read another's payable balance. Same
-- treatment as saved_searches. See ADR 0016.

-- THE LEDGER BALANCE INVARIANT.
--
-- LedgerService.post() already validates before inserting, using the same
-- assertBalanced() the unit tests cover to 100%. That is not enough: it is one
-- function, and nothing stops a service written next year from calling
-- tx.insert(ledgerEntries) directly. "We always call the helper" is a claim no
-- test can make about code that does not exist yet.
--
-- DEFERRABLE INITIALLY DEFERRED is load-bearing. Entries are inserted one
-- statement at a time and are legitimately unbalanced between them; the check
-- has to happen at COMMIT or every transaction fails on its first entry.
--
-- Phase 3 rejected triggers for the search index and that rejection stands.
-- The distinction is assertion versus side effect: a search trigger would have
-- WRITTEN DATA invisibly from the call site, whereas this one writes nothing
-- and can only refuse. An invariant that cannot be bypassed is the entire
-- reason a ledger is trusted.
CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
DECLARE
  residual bigint;
  currencies int;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(DISTINCT currency)
    INTO residual, currencies
    FROM ledger_entries
   WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  IF currencies > 1 THEN
    RAISE EXCEPTION 'Ledger transaction % mixes % currencies; no implicit conversion in the ledger (PRD 10.6)',
      COALESCE(NEW.transaction_id, OLD.transaction_id), currencies;
  END IF;

  IF residual <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance: entries sum to %, expected 0',
      COALESCE(NEW.transaction_id, OLD.transaction_id), residual;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();
--> statement-breakpoint

-- GRANTS, AND WHY THEY ARE WRITTEN AS REVOKES.
--
-- Migration 0001 ran
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
--
-- so every table created afterwards ALREADY carries all four privileges before
-- this file runs. A narrower `GRANT SELECT, INSERT ON ledger_entries` is
-- therefore a no-op that READS like a restriction: it adds two privileges the
-- role already has and removes nothing. Verified against the live database -
-- the first version of this migration left ledger_entries with
-- DELETE, INSERT, SELECT, UPDATE.
--
-- Making a table append-only requires an explicit REVOKE. The GRANTs stay
-- because they are the file's statement of intent and they cost nothing, but
-- the REVOKEs below are what actually holds.
GRANT SELECT, INSERT, UPDATE, DELETE ON "addresses" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "carts" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cart_items" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders" TO nexmarket_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_items" TO nexmarket_app;
--> statement-breakpoint

-- An intent's status is advanced by the webhook, so UPDATE stays. Nothing ever
-- deletes one: a cancelled payment is a status, not an absence.
REVOKE DELETE ON "payment_intents" FROM nexmarket_app;
--> statement-breakpoint

-- A delivered webhook is a historical fact. If it could be deleted, the UNIQUE
-- constraint that makes webhook handling idempotent could be worked around by
-- deleting the row and replaying - which is precisely the double-capture this
-- table exists to prevent.
REVOKE UPDATE, DELETE ON "payment_events" FROM nexmarket_app;
--> statement-breakpoint

-- A money movement that happened cannot un-happen. Corrections are new rows.
REVOKE UPDATE, DELETE ON "transactions" FROM nexmarket_app;
--> statement-breakpoint

-- Accounts are created once and never edited; deleting one would orphan every
-- entry posted against it, and the RESTRICT foreign key would refuse anyway.
REVOKE UPDATE, DELETE ON "ledger_accounts" FROM nexmarket_app;
--> statement-breakpoint

-- APPEND-ONLY, enforced by privilege rather than by discipline. A mistake is
-- corrected by posting a reversing transaction, which is also why refunds
-- (Phase 8) need no schema change. ledger-constraints.test.ts asserts both of
-- these are refused, because a comment claiming immutability and a role that
-- can UPDATE is worse than neither.
REVOKE UPDATE, DELETE ON "ledger_entries" FROM nexmarket_app;
