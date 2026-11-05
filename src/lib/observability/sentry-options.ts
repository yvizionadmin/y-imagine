// Sentry settings shared by the server, the browser and the worker (no SDK import here, so each
// runtime brings its own). Without a DSN the SDKs stay disabled. Secrets must never reach Sentry:
// no default PII, no request bodies, cookies or auth headers, and anything shaped like a key is masked.

import type { Breadcrumb, Event } from "@sentry/nextjs";

// Provider keys (OpenAI, Anthropic, Gemini, OpenRouter), Stripe secrets, webhook secrets, bearer/JWT tokens.
const SECRET = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}|whsec_[0-9A-Za-z]{10,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "x-api-key", "x-goog-api-key", "stripe-signature"]);

function mask<T>(value: T, depth = 0): T {
  if (typeof value === "string") return value.replace(SECRET, "[redacted]") as T;
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => mask(v, depth + 1)) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, depth + 1)])) as T;
}

/** Strips request data and masks secrets anywhere in the event (messages, stack vars, breadcrumbs). */
export function scrubEvent<E extends Event>(event: E): E {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) if (SENSITIVE_HEADERS.has(name.toLowerCase())) delete event.request.headers[name];
    }
  }
  if (event.user) event.user = { id: event.user.id };
  return mask(event);
}

export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: !!dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    // A sample of requests for performance; errors are always sent.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    // Performance spans stream individually; mask their attributes (URLs, query text) the same way.
    beforeSendSpan: <S>(span: S) => mask(span),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => mask(breadcrumb),
  };
}
