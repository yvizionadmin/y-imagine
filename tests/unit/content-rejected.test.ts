import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { blockedReason } from "@/components/app/job-errors";
import { mapError } from "@/lib/ai/providers/ai-sdk";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";

// Safety-filter refusals get their own code and message (change the prompt or image), instead of
// the generic "couldn't make this" failure.

const refused = (body: string) =>
  mapError(new APICallError({ message: "x", url: "https://api.openai.com/v1/images/edits", requestBodyValues: {}, statusCode: 400, responseBody: body, isRetryable: false }), { provider: "openai" });

describe("content refused by the provider's safety filter", () => {
  it("maps OpenAI and Gemini safety refusals to content_rejected", async () => {
    expect((await refused('{"error":{"code":"moderation_blocked","message":"Your request was rejected by the safety system."}}')).code).toBe("content_rejected");
    expect((await refused('{"error":{"message":"Request blocked","status":"INVALID_ARGUMENT","details":[{"reason":"PROHIBITED_CONTENT"}]}}')).code).toBe("content_rejected");
    // Other 400s stay generic.
    expect((await refused('{"error":{"message":"Invalid size"}}')).code).toBe("generation_failed");
  });

  it("is shown as a blocked state with a message in both languages", () => {
    expect(blockedReason("content_rejected")).toBe("content");
    for (const messages of [en, ar]) {
      expect(messages.Workspace.blocked.content.title).toBeTruthy();
      expect(messages.ImageBulk.itemErrors.content_rejected).toBeTruthy();
      expect(messages.CopyBulk.itemErrors.content_rejected).toBeTruthy();
    }
  });
});
