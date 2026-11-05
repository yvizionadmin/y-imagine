import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * An unexpected failure that was handled (the user got an error state): logged without details
 * that could carry secrets, and sent to Sentry (scrubbed) with ids for context.
 */
export function reportError(message: string, error: unknown, context: Record<string, string | number | null | undefined> = {}) {
  console.error(message, { ...context, error: error instanceof Error ? error.name : typeof error });
  Sentry.captureException(error, { tags: { where: message }, extra: context });
}
