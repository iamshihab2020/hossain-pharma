-- Prepended by hand to the generated file, BEFORE it was ever applied.
--
-- `search_documents.tsv` is a tsvector and `category_path` is an ltree, and the
-- trigram operator the search predicate uses needs pg_trgm. tsvector is
-- built in; ltree came with migration 0007; pg_trgm has to exist before the
-- GIN index in 0010, and creating it here keeps every extension this phase
-- needs in the migration that first requires one.
--
-- CREATE EXTENSION needs rights nexmarket_app deliberately lacks, which is why
-- migrations connect as the owner (DATABASE_MIGRATION_URL).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "recently_viewed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recently_viewed_user_product_key" UNIQUE("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_searches_user_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"category_id" uuid NOT NULL,
	"category_slug" text NOT NULL,
	"category_path" "ltree" NOT NULL,
	"search_text" text NOT NULL,
	"tsv" "tsvector" NOT NULL,
	"min_price_amount" bigint,
	"price_currency" char(3),
	"seller_count" integer DEFAULT 0 NOT NULL,
	"in_stock" boolean DEFAULT false NOT NULL,
	"product_created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recently_viewed_user_idx" ON "recently_viewed" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "search_documents_category_idx" ON "search_documents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "search_documents_brand_idx" ON "search_documents" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "search_documents_price_idx" ON "search_documents" USING btree ("min_price_amount");--> statement-breakpoint
CREATE INDEX "search_documents_created_idx" ON "search_documents" USING btree ("product_created_at");