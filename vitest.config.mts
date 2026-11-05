import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit + integration tests (`npm test`). Integration tests use their own Postgres database
// (TEST_DATABASE_URL, default imagine_test), migrated and emptied once per run; outside services
// (AI providers, Clerk, Stripe, Sentry) are stubbed. Files run one at a time: they share that database.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/imagine_test";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Next.js resolves this to nothing on the server; outside Next it would throw.
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/setup/server-only.ts") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.mts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_POOL_SIZE: "5",
      KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      ASSET_DIR: ".data/test-assets",
      IMAGINE_DEMO: "0",
      // Each test opts into these; nothing real is ever called.
      REDIS_URL: "",
      CLERK_SECRET_KEY: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      STRIPE_SECRET_KEY: "",
      SENTRY_DSN: "",
      SUPER_ADMIN_EMAILS: "",
    },
  },
});
