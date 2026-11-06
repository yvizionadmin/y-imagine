import "server-only";
import { generateText } from "ai";
import { createGoogleGenerativeAI, type GoogleLanguageModelInteractionsOptions } from "@ai-sdk/google";
import { ProviderError } from "../errors";
import type { GeneratedVideo, VideoProvider } from "../types";
import { videoPrompt } from "../video-prompt";
import { mapError } from "./ai-sdk";

// Video over the AI SDK, built per job from the org's decrypted key (BYOK). Gemini Omni Flash is
// reached through Google's Interactions API with a video response format; the clip comes back
// inline in `files`. Runs in the worker (a job takes minutes), never in a request.

export type AiVideoConfig = {
  provider: "gemini";
  apiKey: string;
  model: string;
  onKeyRejected?: () => Promise<void>;
};

const TIMEOUT_MS = 10 * 60_000;

export function createAiVideoProvider(config: AiVideoConfig): VideoProvider {
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });

  return {
    id: config.provider,
    model: config.model,

    async generateVideo(request): Promise<GeneratedVideo> {
      // Omni Flash takes 16:9 / 9:16 at 360p–1080p only (the Studio offers no more; this guards the type).
      const { aspectRatio, resolution } = request;
      if ((aspectRatio !== "16:9" && aspectRatio !== "9:16") || resolution === "480p") throw new ProviderError("unsupported");
      const text = videoPrompt(request);
      try {
        const result = await generateText({
          model: google.interactions(config.model),
          messages: [
            {
              role: "user",
              content: request.startFrame
                ? [
                    { type: "file", data: request.startFrame.bytes, mediaType: request.startFrame.mimeType },
                    { type: "text", text },
                  ]
                : [{ type: "text", text }],
            },
          ],
          providerOptions: {
            google: {
              store: false,
              responseFormat: [
                { type: "video", aspectRatio, resolution, duration: `${request.seconds}s`, delivery: "inline" },
              ],
            } satisfies GoogleLanguageModelInteractionsOptions,
          },
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
          maxRetries: 1,
        });
        const video = result.files.find((f) => f.mediaType.startsWith("video/"));
        if (!video) throw new ProviderError(result.finishReason === "content-filter" ? "content_rejected" : "generation_failed");
        return { bytes: video.uint8Array, mimeType: video.mediaType === "video/webm" ? "video/webm" : "video/mp4", provider: config.provider, model: config.model };
      } catch (error) {
        throw await mapError(error, config);
      }
    },
  };
}
