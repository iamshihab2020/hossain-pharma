-- Prepended by hand to the generated file, BEFORE it was ever applied.
--
-- `categories.path` is an ltree column, so the extension has to exist before
-- the CREATE TABLE below runs. drizzle-kit generates the table and knows
-- nothing about the extension the custom type needs, and putting the extension
-- in the next migration is one statement too late.
--
-- CREATE EXTENSION needs rights nexmarket_app deliberately lacks, which is why
-- migrations connect as the owner (DATABASE_MIGRATION_URL).
CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE TYPE "public"."attribute_datatype" AS ENUM('TEXT', 'NUMBER', 'BOOL');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."listing_condition" AS ENUM('NEW', 'REFURBISHED', 'USED');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pincode" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_tenant_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"path" "ltree" NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"position" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "category_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"datatype" "attribute_datatype" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_facetable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_attributes_category_key_key" UNIQUE("category_id","key")
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_text" text,
	"value_number" double precision,
	"value_bool" boolean,
	CONSTRAINT "product_attributes_product_key_key" UNIQUE("product_id","key")
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"original_filename" text NOT NULL,
	"alt_text" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"barcode" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"description" text,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"proposed_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_listing_warehouse_key" UNIQUE("listing_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"status" "listing_status" DEFAULT 'DRAFT' NOT NULL,
	"condition" "listing_condition" DEFAULT 'NEW' NOT NULL,
	"price_amount" bigint NOT NULL,
	"price_currency" char(3) NOT NULL,
	"sale_price_amount" bigint,
	"shipping_amount" bigint DEFAULT 0 NOT NULL,
	"dispatch_days" integer DEFAULT 1 NOT NULL,
	"available_stock" integer DEFAULT 0 NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_tenant_variant_key" UNIQUE("tenant_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouses_tenant_idx" ON "warehouses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_path_btree_idx" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "category_attributes_category_idx" ON "category_attributes" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_attributes_key_text_idx" ON "product_attributes" USING btree ("key","value_text");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_idx" ON "inventory_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_items_listing_idx" ON "inventory_items" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listings_variant_idx" ON "listings" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "listings_tenant_idx" ON "listings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");