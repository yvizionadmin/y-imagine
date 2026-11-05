ALTER TABLE "looks" ADD COLUMN "category" text DEFAULT 'furniture' NOT NULL;--> statement-breakpoint
ALTER TABLE "looks" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "room_backgrounds" ADD COLUMN "category" text DEFAULT 'furniture' NOT NULL;