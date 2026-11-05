CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_status" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_period_end" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripeCustomerId_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripeSubscriptionId_unique" UNIQUE("stripe_subscription_id");