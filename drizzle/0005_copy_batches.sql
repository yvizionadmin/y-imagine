CREATE TABLE "copy_batch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"position" integer NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"category" text,
	"details" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"copy_id" text,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"finished_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "copy_batch_items" ADD CONSTRAINT "copy_batch_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_batch_items" ADD CONSTRAINT "copy_batch_items_batch_id_copy_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."copy_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_batch_items" ADD CONSTRAINT "copy_batch_items_copy_id_copy_generations_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copy_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_batches" ADD CONSTRAINT "copy_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copy_batch_items_batch_id_position_index" ON "copy_batch_items" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "copy_batch_items_status_updated_at_index" ON "copy_batch_items" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "copy_batches_org_id_created_at_index" ON "copy_batches" USING btree ("org_id","created_at");