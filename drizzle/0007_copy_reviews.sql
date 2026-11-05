ALTER TABLE "copy_generations" ADD COLUMN "review_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "copy_generations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "copy_generations" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "copy_generations" ADD COLUMN "reviewed_at" timestamp(3) with time zone;--> statement-breakpoint
CREATE INDEX "copy_generations_org_id_review_status_index" ON "copy_generations" USING btree ("org_id","review_status");