import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev logs print Server Function arguments, which would put AI provider keys and store
  // credentials in the terminal.
  logging: { serverFunctions: false },
  // Dev only: on non-Apple disks (exFAT) macOS writes `._*` stubs into the image cache and
  // Next serves the stub instead of the picture. Production (Railway) still optimizes.
  images: { unoptimized: process.env.NODE_ENV === "development" },
  experimental: {
    // Product PNGs up to 10 MB plus multipart overhead
    serverActions: { bodySizeLimit: "11mb" },
    // The proxy buffers request bodies up to this size: video editor clip uploads (50 MB) + multipart overhead.
    proxyClientMaxBodySize: "52mb",
  },
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Sentry: source maps are uploaded at build time only when SENTRY_AUTH_TOKEN (+ org/project) is set.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
