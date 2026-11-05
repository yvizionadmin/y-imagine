ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_session_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerkUserId_unique" UNIQUE("clerk_user_id");