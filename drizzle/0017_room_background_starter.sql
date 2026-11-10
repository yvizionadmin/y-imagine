ALTER TABLE "room_backgrounds" ADD COLUMN "starter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the starter set seeded before this column (src/lib/looks/room-backgrounds.ts SEED). A starter an admin renamed stays a team scene.
UPDATE "room_backgrounds" SET "starter" = true WHERE "category" = 'furniture' AND "room_type" = 'livingRoom' AND "name" IN ('Nordic Living Room', 'Minimalist Concrete Studio', 'Luxury Loft Lounge');
