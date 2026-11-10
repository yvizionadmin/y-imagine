import "server-only";
import { generateText, isStepCount, Output, streamText, tool, type LanguageModel, type ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { copyPrompt, copySchema, tidyCopy } from "../copy-prompt";
import { improvePromptText, tidyPrompt } from "../prompt-improve";
import { ProviderError } from "../errors";
import type { TextProviderId } from "../models";
import type { CopyLanguage, ProductCopy, TextProvider } from "../types";
import { mapError } from "./ai-sdk";

// Real text provider over the AI SDK, built per job from the org's decrypted key (BYOK). One
// structured call writes every requested language, so EN and AR describe the same facts.

export type AiTextConfig = {
  provider: TextProviderId;
  apiKey: string;
  model: string;
  /** Called when the provider rejects the key, so its status can turn invalid in Settings. */
  onKeyRejected?: () => Promise<void>;
};

const TIMEOUT_MS = 90_000;
const PROMPT_TIMEOUT_MS = 30_000;
/** A chat reply may take longer than copy, but must start soon and never stall. */
const CHAT_TIMEOUT = { totalMs: 180_000, firstChunkMs: 60_000, chunkMs: 30_000 };
const CHAT_MAX_TOKENS = 8_000;
/** An agent run waits on tools (an image can take a minute), so its budget is the whole run, not each chunk. */
const AGENT_TIMEOUT = { totalMs: 10 * 60_000, firstChunkMs: 90_000 };

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function languageModel({ provider, apiKey, model }: AiTextConfig): LanguageModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "openrouter":
      return createOpenRouter({ apiKey }).chat(model);
  }
}

/** Most an improved prompt may be (the instruction boxes cap at 2000). */
const PROMPT_MAX_CHARS = 600;

// Reasoning models (gpt-5) count hidden reasoning against maxOutputTokens: at a 4k cap and default
// effort they spent it all thinking and returned no copy. Low effort is plenty for retail writing.
const reasoning = (config: AiTextConfig, effort: "minimal" | "low") =>
  config.provider === "openai" && /^gpt-5/.test(config.model) ? { providerOptions: { openai: { reasoningEffort: effort } } } : {};

export function createAiTextProvider(config: AiTextConfig): TextProvider {
  const model = languageModel(config);
  return {
    id: config.provider,
    model: config.model,

    async generateCopy(request) {
      try {
        const { output } = await generateText({
          model,
          output: Output.object({ schema: copySchema(request.languages) }),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: copyPrompt(request, words) },
                ...(request.image ? [{ type: "file" as const, data: request.image.bytes, mediaType: request.image.mimeType }] : []),
              ],
            },
          ],
          maxOutputTokens: 16_000,
          ...reasoning(config, "low"),
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
          maxRetries: 1,
        });
        const copy: Partial<Record<CopyLanguage, ProductCopy>> = {};
        for (const language of request.languages) {
          const written = (output as Record<CopyLanguage, ProductCopy | undefined>)[language];
          if (!written) throw new ProviderError("generation_failed");
          copy[language] = tidyCopy(written);
        }
        return { copy, provider: config.provider, model: config.model };
      } catch (error) {
        throw await mapError(error, config);
      }
    },

    async *streamChat(request) {
      try {
        const result = streamText({
          model,
          system: request.system,
          messages: request.messages,
          maxOutputTokens: CHAT_MAX_TOKENS,
          ...reasoning(config, "low"),
          timeout: CHAT_TIMEOUT,
          abortSignal: request.signal,
          maxRetries: 1,
        });
        let wrote = false;
        for await (const part of result.fullStream) {
          if (part.type === "text-delta" && part.text) {
            wrote = true;
            yield part.text;
          } else if (part.type === "error") {
            throw part.error;
          }
        }
        // Stopped by the user: what was written is the reply. Nothing at all is a failed job.
        if (!wrote && !request.signal?.aborted) throw new ProviderError("generation_failed");
      } catch (error) {
        if (request.signal?.aborted) return;
        throw await mapError(error, config);
      }
    },

    async *runAgent(request) {
      const tools: ToolSet = Object.fromEntries(
        request.tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.input, execute: (input: unknown) => t.execute(input) })]),
      );
      try {
        const result = streamText({
          model,
          system: request.system,
          prompt: request.prompt,
          tools,
          stopWhen: isStepCount(request.maxSteps),
          maxOutputTokens: CHAT_MAX_TOKENS,
          ...reasoning(config, "low"),
          timeout: AGENT_TIMEOUT,
          abortSignal: request.signal,
          maxRetries: 1,
        });
        let acted = false;
        for await (const part of result.fullStream) {
          if (part.type === "text-delta" && part.text) {
            acted = true;
            yield { type: "text", text: part.text };
          } else if (part.type === "tool-call") {
            acted = true;
            yield { type: "tool-call", id: part.toolCallId, name: part.toolName, input: part.input };
          } else if (part.type === "tool-result" && !part.preliminary) {
            yield { type: "tool-result", id: part.toolCallId, name: part.toolName, output: part.output };
          } else if (part.type === "tool-error") {
            yield { type: "tool-error", id: part.toolCallId, name: part.toolName, error: part.error };
          } else if (part.type === "error") {
            throw part.error;
          }
        }
        if (!acted && !request.signal?.aborted) throw new ProviderError("generation_failed");
      } catch (error) {
        if (request.signal?.aborted) return;
        throw await mapError(error, config);
      }
    },

    async improvePrompt(request) {
      try {
        const { text } = await generateText({
          model,
          prompt: improvePromptText(request, words),
          maxOutputTokens: 4_000,
          ...reasoning(config, "minimal"),
          abortSignal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
          maxRetries: 1,
        });
        const improved = tidyPrompt(text, PROMPT_MAX_CHARS);
        if (!improved) throw new ProviderError("generation_failed");
        return { text: improved, model: config.model };
      } catch (error) {
        throw await mapError(error, config);
      }
    },
  };
}
