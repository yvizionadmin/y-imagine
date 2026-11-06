import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { mapError } from "@/lib/ai/providers/ai-sdk";

const callError = (statusCode: number, responseBody: string) =>
  new APICallError({ message: "x", url: "https://generativelanguage.googleapis.com/v1beta/interactions", requestBodyValues: {}, statusCode, responseBody, isRetryable: statusCode === 429 });
const code = async (status: number, body: string) => (await mapError(callError(status, body), { provider: "gemini" })).code;

describe("provider error codes", () => {
  it("treats a zero quota (Free Tier key on a paid model) as an account problem, not a rate limit", async () => {
    const freeTier = '{"error":{"message":"Rate limit exceeded for model gemini-omni-1.2-flash (limit: 0 requests per day on Free Tier). Please upgrade your tier at https://ai.dev/rate-limit.","code":"too_many_requests"}}';
    expect(await code(429, freeTier)).toBe("no_credits");
  });

  it("keeps real rate limits retryable", async () => {
    expect(await code(429, '{"error":{"message":"Rate limit exceeded. Try again in 20s (limit: 10 requests per minute)."}}')).toBe("rate_limited");
  });
});
