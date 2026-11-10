CREATE TABLE "video_cleanup_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"through" timestamp(3) with time zone NOT NULL,
	"count" integer NOT NULL,
	"sent_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_cleanup_notices" ADD CONSTRAINT "video_cleanup_notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_cleanup_notices_org_id_sent_at_index" ON "video_cleanup_notices" USING btree ("org_id","sent_at");