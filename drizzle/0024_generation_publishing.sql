ALTER TABLE "generations" ADD COLUMN "publish_ref" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "publish_started_at" timestamp(3) with time zone;