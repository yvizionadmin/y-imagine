import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOptions } from "@/lib/observability/sentry-options";

const OPENAI = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
const GEMINI = "AIzaSyA1234567890abcdefghijklmnopqrstu";
const STRIPE = "sk_test_51Habcdefghijklmnop";
const WEBHOOK = "whsec_abcdefghijklmnop";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("Sentry scrubbing", () => {
  it("masks keys and tokens anywhere in the event", () => {
    const event = scrubEvent({
      message: `failed with ${OPENAI}`,
      extra: { nested: { list: [`x-goog-api-key: ${GEMINI}`] }, stripe: STRIPE, hook: WEBHOOK, auth: "Bearer abcdefghijklmnopqrstuv", jwt: JWT },
    });
    const text = JSON.stringify(event);
    for (const secret of [OPENAI, GEMINI, STRIPE, WEBHOOK, "abcdefghijklmnopqrstuv", JWT]) expect(text).not.toContain(secret);
    expect(text).toContain("[redacted]");
  });

  it("drops request bodies, cookies, query strings and auth headers", () => {
    const event = scrubEvent({
      request: { url: "https://app/x", data: "form", cookies: { a: "b" }, query_string: "token=1", headers: { Authorization: "x", Cookie: "y", "stripe-signature": "z", "user-agent": "ua" } },
    });
    expect(event.request).toEqual({ url: "https://app/x", headers: { "user-agent": "ua" } });
  });

  it("reduces the user to an id", () => {
    expect(scrubEvent({ user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4", username: "n" } }).user).toEqual({ id: "u1" });
  });

  it("is disabled without a DSN and never sends default PII", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, sendDefaultPii: false });
    expect(sentryOptions("http://k@host/1").enabled).toBe(true);
  });
});
