import * as Sentry from "@sentry/nextjs";

// Server error tracking (Sentry), off without SENTRY_DSN. The app only uses the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

/** Errors thrown while rendering, in route handlers, server actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
