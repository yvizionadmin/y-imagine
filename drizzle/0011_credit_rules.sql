CREATE TABLE "credit_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "credit_rules" jsonb;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "credits" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_adjustments_org_id_at_index" ON "credit_adjustments" USING btree ("org_id","at");