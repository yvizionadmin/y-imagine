CREATE TABLE "video_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"timeline" jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"output_asset_id" text,
	"output_mime" text,
	"output_seconds" real,
	"error" text,
	"created_by" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"rendered_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "video_edits" ADD CONSTRAINT "video_edits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_edits_org_id_updated_at_index" ON "video_edits" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "video_edits_status_updated_at_index" ON "video_edits" USING btree ("status","updated_at");