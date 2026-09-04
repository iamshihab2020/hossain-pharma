CREATE TYPE "public"."org_role" AS ENUM('OWNER', 'MANAGER', 'STAFF', 'FINANCE');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('TRADE_LICENCE', 'NATIONAL_ID', 'BANK_PROOF');--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_tenant_user_role_key" UNIQUE("tenant_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "seller_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_tenant_idx" ON "org_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "seller_documents_tenant_idx" ON "seller_documents" USING btree ("tenant_id");