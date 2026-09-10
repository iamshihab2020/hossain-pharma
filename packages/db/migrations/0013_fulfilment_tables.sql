-- Phase 5 fulfilment: the tables a shipment needs, the states an order can now
-- reach, and the column that records what a line lost.
--
-- Row-level security, the append-only revoke and the over-shipment invariant
-- are all in 0014. This file is structure only.

-- ALTER TYPE ... ADD VALUE is permitted inside a transaction on PG 12+, but the
-- new value CANNOT BE USED in the same transaction that adds it. Nothing below
-- references them - the first use is in application code, later - so this is
-- safe. Worth stating, because the failure mode is a migration that passes on a
-- warm database and dies on a fresh one.
ALTER TYPE "public"."order_status" ADD VALUE 'ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'PARTIALLY_SHIPPED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'SHIPPED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'DELIVERED';--> statement-breakpoint

-- The release posting. `transaction_kind` already carries REFUND, which is what
-- a cancellation posts - ADR 0016 said refunds would need no schema change, and
-- this is the first occasion to find out whether that was true. It was.
ALTER TYPE "public"."transaction_kind" ADD VALUE 'FULFILMENT';--> statement-breakpoint

CREATE TYPE "public"."shipment_status" AS ENUM('DISPATCHED', 'DELIVERED');--> statement-breakpoint
CREATE TYPE "public"."order_event_type" AS ENUM('PLACED', 'PAID', 'ACCEPTED', 'REJECTED', 'SHIPMENT_DISPATCHED', 'SHIPMENT_DELIVERED', 'LINES_CANCELLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_event_actor" AS ENUM('BUYER', 'SELLER', 'SYSTEM');--> statement-breakpoint

-- Units cancelled or rejected. Shipped quantity is deliberately NOT a column:
-- it is SUM(shipment_items.quantity), because a denormalised counter would have
-- two writers - dispatch and cancellation - and drift under concurrency.
ALTER TABLE "order_items" ADD COLUMN "cancelled_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_cancelled_within_ordered"
  CHECK ("order_items"."cancelled_quantity" >= 0
     AND "order_items"."cancelled_quantity" <= "order_items"."quantity");--> statement-breakpoint

CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_number" text NOT NULL,
	"status" "shipment_status" DEFAULT 'DISPATCHED' NOT NULL,
	"carrier_name" text,
	"tracking_number" text,
	"release_amount" bigint NOT NULL,
	"release_commission" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"idempotency_key" text NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_number_key" UNIQUE("shipment_number"),
	CONSTRAINT "shipments_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "shipments_release_non_negative" CHECK ("shipments"."release_amount" >= 0 AND "shipments"."release_commission" >= 0),
	CONSTRAINT "shipments_commission_within_release" CHECK ("shipments"."release_commission" <= "shipments"."release_amount")
);
--> statement-breakpoint

CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_items_quantity_positive" CHECK ("shipment_items"."quantity" > 0)
);
--> statement-breakpoint

CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"type" "order_event_type" NOT NULL,
	"actor" "order_event_actor" NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- RESTRICT for the reason order_items.listing_id is: this row is the evidence
-- of what was sent.
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- SET NULL rather than RESTRICT: a deleted account must not take the order's
-- history with it.
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "shipments_tenant_idx" ON "shipments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipment_items_tenant_idx" ON "shipment_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shipment_items_shipment_idx" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_items_order_item_idx" ON "shipment_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_events_tenant_idx" ON "order_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "order_events_buyer_idx" ON "order_events" USING btree ("buyer_user_id");
