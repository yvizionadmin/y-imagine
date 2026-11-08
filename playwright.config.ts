import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (`npm run test:e2e`) against the production build (`next build` first) on port
// 3100, with its own database and demo mode: no Clerk, Stripe, Sentry or real AI provider is called.
const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/imagine_e2e_test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "en-US" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `tsx tests/e2e/prepare-db.mts && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    env: {
      DATABASE_URL,
      TEST_DATABASE_URL: DATABASE_URL,
      IMAGINE_DEMO: "1",
      ASSET_DIR: ".data/e2e-assets",
      REDIS_URL: "",
      AUTH_LIMIT_PER_IP: "1000",
      CLERK_SECRET_KEY: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      STRIPE_SECRET_KEY: "",
      SENTRY_DSN: "",
      SUPER_ADMIN_EMAILS: "",
      APP_URL: `http://localhost:${PORT}`,
      EMAIL_OUTBOX_DIR: ".data/e2e-outbox",
    },
  },
});
