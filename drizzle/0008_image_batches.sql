CREATE TABLE "image_batch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"position" integer NOT NULL,
	"sku" text NOT NULL,
	"product_size" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"generation_id" text,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"tool" text NOT NULL,
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
ALTER TABLE "image_batch_items" ADD CONSTRAINT "image_batch_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batch_items" ADD CONSTRAINT "image_batch_items_batch_id_image_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."image_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batch_items" ADD CONSTRAINT "image_batch_items_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batches" ADD CONSTRAINT "image_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_batch_items_batch_id_position_index" ON "image_batch_items" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "image_batch_items_status_updated_at_index" ON "image_batch_items" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "image_batches_org_id_created_at_index" ON "image_batches" USING btree ("org_id","created_at");