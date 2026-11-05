CREATE TABLE "brand_kits" (
	"org_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"about" text NOT NULL,
	"voice" text NOT NULL,
	"audience" text NOT NULL,
	"use_words" jsonb NOT NULL,
	"avoid_words" jsonb NOT NULL,
	"rules" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;