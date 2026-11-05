CREATE TABLE "copy_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"copy" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copy_generations" ADD CONSTRAINT "copy_generations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copy_generations_org_id_created_at_index" ON "copy_generations" USING btree ("org_id","created_at");