CREATE TYPE "public"."return_pickup_status" AS ENUM('SCHEDULED', 'COLLECTED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'OUT_FOR_DELIVERY' BEFORE 'DELIVERED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'SHIPMENT_IN_TRANSIT' BEFORE 'SHIPMENT_DELIVERED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'SHIPMENT_OUT_FOR_DELIVERY' BEFORE 'SHIPMENT_DELIVERED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'COD_COLLECTED' BEFORE 'LINES_CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'RETURN_PICKUP_SCHEDULED' BEFORE 'LINES_CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'IN_TRANSIT' BEFORE 'DELIVERED';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'OUT_FOR_DELIVERY' BEFORE 'DELIVERED';--> statement-breakpoint
CREATE TABLE "return_pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"status" "return_pickup_status" DEFAULT 'SCHEDULED' NOT NULL,
	"pickup_address" jsonb NOT NULL,
	"collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_slot_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_collected_amount" bigint;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_slot_id_delivery_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."delivery_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_pickups_one_live_per_order" ON "return_pickups" USING btree ("order_id") WHERE "return_pickups"."status" = 'SCHEDULED';--> statement-breakpoint
CREATE INDEX "return_pickups_tenant_idx" ON "return_pickups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "return_pickups_buyer_idx" ON "return_pickups" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "return_pickups_slot_idx" ON "return_pickups" USING btree ("slot_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_slot_id_delivery_slots_id_fk" FOREIGN KEY ("delivery_slot_id") REFERENCES "public"."delivery_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_warehouse_idx" ON "shipments" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("carrier_name","tracking_number");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_collection_complete" CHECK (num_nonnulls("orders"."cod_collected_at", "orders"."cod_collected_amount") IN (0, 2));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_collected_non_negative" CHECK ("orders"."cod_collected_amount" IS NULL OR "orders"."cod_collected_amount" >= 0);