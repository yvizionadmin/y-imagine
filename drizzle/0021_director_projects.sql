CREATE TABLE "director_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idea" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"settings" jsonb NOT NULL,
	"scenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"failed_step" text,
	"error" text,
	"voice_asset_id" text,
	"edit_id" text,
	"locked_until" timestamp(3) with time zone,
	"created_by" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "director_projects" ADD CONSTRAINT "director_projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_projects_org_id_updated_at_index" ON "director_projects" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "director_projects_status_updated_at_index" ON "director_projects" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "director_projects_edit_id_index" ON "director_projects" USING btree ("edit_id");