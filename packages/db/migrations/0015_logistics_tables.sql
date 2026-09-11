--
-- Phase 6 geography, and the shipping measurements a rate card needs.
--
-- HAND-TRIMMED, and the reason matters to whoever generates the next one.
--
-- `drizzle-kit generate --custom` writes a journal entry and a snapshot, but
-- the snapshot it writes is a COPY OF THE PREVIOUS ONE rather than the current
-- schema. Migrations 0013 and 0014 were both --custom, so the snapshot chain
-- froze at Phase 4 and this file's first draft re-emitted the whole of Phase 5:
-- CREATE TABLE shipments, shipment_items, order_events, the order_status enum
-- values, and order_items.cancelled_quantity. Applying that to any existing
-- database fails on the first CREATE.
--
-- The 0015 SNAPSHOT drizzle wrote alongside it is correct - it diffed the real
-- schema - so it is kept as-is and the SQL below is trimmed to the Phase 6
-- delta only. That repairs the chain: 0016 will diff from a snapshot that knows
-- about Phase 5.
--
-- All four new tables are PLATFORM-OWNED and therefore carry no RLS, which is
-- the same call the catalogue got in migration 0007 and for the same reason:
-- the product page runs with no tenant context and PRD 8.4 puts a
-- serviceability check on it for an anonymous visitor. See the header comment
-- in src/schema/logistics.ts.
--
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"cod_allowed" boolean DEFAULT true NOT NULL,
	"transit_days_min" integer NOT NULL,
	"transit_days_max" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_code_unique" UNIQUE("code"),
	CONSTRAINT "delivery_zones_transit_ordered" CHECK ("delivery_zones"."transit_days_min" <= "delivery_zones"."transit_days_max"),
	CONSTRAINT "delivery_zones_transit_positive" CHECK ("delivery_zones"."transit_days_min" >= 0)
);
--> statement-breakpoint
CREATE TABLE "serviceability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) NOT NULL,
	"postcode" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"area_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serviceability_country_postcode_key" UNIQUE("country_code","postcode")
);
--> statement-breakpoint
CREATE TABLE "zone_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"max_weight_grams" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_rates_zone_band_key" UNIQUE("zone_id","max_weight_grams"),
	CONSTRAINT "zone_rates_weight_positive" CHECK ("zone_rates"."max_weight_grams" > 0),
	CONSTRAINT "zone_rates_amount_non_negative" CHECK ("zone_rates"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"capacity" integer NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_slots_zone_date_start_key" UNIQUE("zone_id","slot_date","start_minute"),
	CONSTRAINT "delivery_slots_window_ordered" CHECK ("delivery_slots"."start_minute" >= 0 AND "delivery_slots"."start_minute" < "delivery_slots"."end_minute" AND "delivery_slots"."end_minute" <= 1440),
	CONSTRAINT "delivery_slots_capacity_positive" CHECK ("delivery_slots"."capacity" > 0),
	CONSTRAINT "delivery_slots_booked_within_capacity" CHECK ("delivery_slots"."booked" >= 0 AND "delivery_slots"."booked" <= "delivery_slots"."capacity")
);
--> statement-breakpoint
ALTER TABLE "serviceability" ADD CONSTRAINT "serviceability_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_rates" ADD CONSTRAINT "zone_rates_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_zones_country_idx" ON "delivery_zones" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "serviceability_zone_idx" ON "serviceability" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "zone_rates_zone_idx" ON "zone_rates" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "delivery_slots_zone_date_idx" ON "delivery_slots" USING btree ("zone_id","slot_date");--> statement-breakpoint

--
-- The seller's own building, extended in place as warehouses.ts promised in
-- Phase 2. Defaults on every column so the existing rows stay valid; the
-- console makes them required going forward.
--
ALTER TABLE "warehouses" ADD COLUMN "address_line" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "district" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "country_code" char(2) DEFAULT 'BD' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "contact_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "is_pickup_point" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

--
-- Shipping measurements on the VARIANT, not the listing: PRD 8.3 shares a
-- catalogue entry between competing sellers, and two sellers of the same phone
-- ship the same box.
--
-- Nullable, because the catalogue predates them and a backfilled zero is a
-- worse answer than no answer. The dimensions check is all-three-or-none: two
-- of three cannot produce a volume, and a partially-measured box that silently
-- skips the volumetric comparison is the failure worth making impossible.
--
ALTER TABLE "product_variants" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_weight_positive" CHECK ("product_variants"."weight_grams" IS NULL OR "product_variants"."weight_grams" > 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_dimensions_complete" CHECK (num_nonnulls("product_variants"."length_mm", "product_variants"."width_mm", "product_variants"."height_mm") IN (0, 3));
