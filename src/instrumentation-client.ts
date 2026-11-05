import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry-options";

// Browser error tracking, off without NEXT_PUBLIC_SENTRY_DSN. No session replay: screens show
// customers' product images and catalog data.
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
