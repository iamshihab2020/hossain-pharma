CREATE TABLE "order_item_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_allocations_item_warehouse_key" UNIQUE("order_item_id","warehouse_id"),
	CONSTRAINT "order_item_allocations_quantity_non_negative" CHECK ("order_item_allocations"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_item_allocations" ADD CONSTRAINT "order_item_allocations_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_allocations" ADD CONSTRAINT "order_item_allocations_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_allocations" ADD CONSTRAINT "order_item_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_allocations_tenant_idx" ON "order_item_allocations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "order_item_allocations_item_idx" ON "order_item_allocations" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_item_allocations_warehouse_idx" ON "order_item_allocations" USING btree ("warehouse_id");