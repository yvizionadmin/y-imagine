ALTER TABLE "generations" ADD COLUMN "review_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "reviewed_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "require_image_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "generations_org_id_review_status_index" ON "generations" USING btree ("org_id","review_status");