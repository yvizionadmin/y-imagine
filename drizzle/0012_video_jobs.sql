CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"status" text NOT NULL,
	"prompt" text NOT NULL,
	"settings" jsonb NOT NULL,
	"start_frame_asset_id" text,
	"start_frame_mime" text,
	"asset_id" text,
	"mime_type" text,
	"credits" integer NOT NULL,
	"provider" text,
	"model" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"finished_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_jobs_org_id_created_at_index" ON "video_jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "video_jobs_status_updated_at_index" ON "video_jobs" USING btree ("status","updated_at");