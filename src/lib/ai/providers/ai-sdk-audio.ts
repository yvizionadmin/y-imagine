import "server-only";
import { APICallError, generateSpeech } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { ProviderError } from "../errors";
import type { AudioProviderId } from "../models";
import type { AudioProvider, GeneratedAudio, MusicRequest, SpeechRequest, VoiceStyle } from "../types";
import { mapError } from "./ai-sdk";

// Real voice-over and music, built per job from the org's decrypted key (BYOK). Speech goes through
// the AI SDK (OpenAI TTS, Gemini TTS). Music is Gemini's Lyria on the Interactions API, called
// directly: the AI SDK's interactions model sends audio requests but drops audio blocks from the
// response. The request and response shapes are the ones that model uses.

export type AiAudioConfig = {
  provider: AudioProviderId;
  apiKey: string;
  model: string;
  onKeyRejected?: () => Promise<void>;
};

const SPEECH_TIMEOUT_MS = 90_000;
const MUSIC_TIMEOUT_MS = 180_000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Each provider's voice for a style. */
export const VOICES: Record<AudioProviderId, Record<VoiceStyle, string>> = {
  openai: { warm: "coral", bright: "nova", calm: "sage", deep: "onyx" },
  gemini: { warm: "Sulafat", bright: "Puck", calm: "Kore", deep: "Charon" },
};

/** OpenAI's older tts-1 models take no directions; the others do. */
const takesDirections = (config: AiAudioConfig) => !(config.provider === "openai" && /^tts-1/.test(config.model));

type InteractionBlock = { type?: string; data?: string; mime_type?: string; uri?: string };
type InteractionResponse = { status?: string; steps?: { type?: string; content?: InteractionBlock[] }[] };

const MUSIC_TYPES: Record<string, GeneratedAudio["mimeType"]> = { "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav" };

export function createAiAudioProvider(config: AiAudioConfig): AudioProvider {
  return {
    id: config.provider,
    model: config.model,

    async speak(request: SpeechRequest) {
      try {
        const model = config.provider === "openai" ? createOpenAI({ apiKey: config.apiKey }).speech(config.model) : createGoogleGenerativeAI({ apiKey: config.apiKey }).speech(config.model);
        const { audio } = await generateSpeech({
          model,
          text: request.text,
          voice: VOICES[config.provider][request.voice],
          outputFormat: config.provider === "openai" ? "mp3" : "wav",
          ...(request.direction && takesDirections(config) ? { instructions: request.direction } : {}),
          abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
          maxRetries: 1,
        });
        const bytes = audio.uint8Array;
        if (!bytes.length) throw new ProviderError("generation_failed");
        return { bytes, mimeType: config.provider === "openai" ? "audio/mpeg" : "audio/wav", provider: config.provider, model: config.model };
      } catch (error) {
        throw await mapError(error, config);
      }
    },

    async compose(request: MusicRequest) {
      if (config.provider !== "gemini") throw new ProviderError("unsupported");
      const url = `${GEMINI_BASE}/interactions`;
      const body = {
        model: config.model,
        input: [{ type: "user_input", content: [{ type: "text", text: `Instrumental music, no vocals. ${request.prompt}` }] }],
        response_format: [{ type: "audio", mime_type: "audio/mpeg" }],
        store: false,
      };
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(MUSIC_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) {
          throw new APICallError({ message: `Gemini interactions ${response.status}`, url, requestBodyValues: {}, statusCode: response.status, responseBody: text });
        }
        const json = JSON.parse(text) as InteractionResponse;
        const block = (json.steps ?? []).flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((b) => b.type === "audio" && b.data);
        const mimeType = MUSIC_TYPES[(block?.mime_type ?? "audio/mpeg").split(";")[0].toLowerCase()];
        if (!block?.data || !mimeType) throw new ProviderError("generation_failed");
        const bytes = new Uint8Array(Buffer.from(block.data, "base64"));
        if (!bytes.length) throw new ProviderError("generation_failed");
        return { bytes, mimeType, provider: config.provider, model: config.model };
      } catch (error) {
        throw await mapError(error, config);
      }
    },
  };
}
