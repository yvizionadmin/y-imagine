CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"byte_size" integer,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"target" text NOT NULL,
	"meta" jsonb,
	"at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bitly_connections" (
	"org_id" text PRIMARY KEY NOT NULL,
	"secret" jsonb NOT NULL,
	"hint" text NOT NULL,
	"login" text NOT NULL,
	"group_guid" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"secret" jsonb,
	"secret_hints" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"last_test" jsonb
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode" text NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"asset_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"published_to" text,
	"published_at" timestamp(3) with time zone,
	"publish_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "looks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"style" text,
	"aspect_ratio" text NOT NULL,
	"background_id" text,
	"room_type" text,
	"items" jsonb NOT NULL,
	"result_asset_id" text NOT NULL,
	"is_board" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'generated' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text NOT NULL,
	"credits_override" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"room_backgrounds_seeded" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"maintenance" jsonb NOT NULL,
	"signups_enabled" boolean NOT NULL,
	"default_plan" text NOT NULL,
	"disabled_features" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"secret" jsonb NOT NULL,
	"hint" text NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"models" jsonb,
	"validated_at" timestamp(3) with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_backgrounds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"room_type" text NOT NULL,
	"style" text NOT NULL,
	"asset_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "short_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bitlink_id" text NOT NULL,
	"short_url" text NOT NULL,
	"long_url" text NOT NULL,
	"title" text NOT NULL,
	"clicks" integer,
	"clicks_checked_at" timestamp(3) with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"feature" text NOT NULL,
	"user_id" text,
	"user_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"platform_role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"last_sign_in_at" timestamp(3) with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bitly_connections" ADD CONSTRAINT "bitly_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_connections" ADD CONSTRAINT "catalog_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "looks" ADD CONSTRAINT "looks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_backgrounds" ADD CONSTRAINT "room_backgrounds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_org_id_index" ON "assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_id_at_index" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "catalog_connections_org_id_index" ON "catalog_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "generations_org_id_created_at_index" ON "generations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "looks_org_id_index" ON "looks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_id_email_index" ON "members" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "members_user_id_index" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_org_id_provider_index" ON "provider_credentials" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "room_backgrounds_org_id_index" ON "room_backgrounds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "short_links_org_id_created_at_index" ON "short_links" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_org_id_at_index" ON "usage_events" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "usage_events_at_index" ON "usage_events" USING btree ("at");