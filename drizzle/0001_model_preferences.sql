CREATE TABLE "model_preferences" (
	"org_id" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "model_preferences_org_id_feature_pk" PRIMARY KEY("org_id","feature")
);
--> statement-breakpoint
ALTER TABLE "model_preferences" ADD CONSTRAINT "model_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;