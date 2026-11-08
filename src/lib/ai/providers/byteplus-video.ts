import "server-only";
import { ProviderError } from "../errors";
import type { GeneratedVideo, VideoProvider } from "../types";
import { videoPrompt } from "../video-prompt";
import { downloadVideo } from "./video-download";

// Seedance on BytePlus ModelArk, built per job from the org's decrypted key (BYOK). ModelArk runs
// video as an async task: create it, poll it, then download the clip from `content.video_url`
// (a signed link that expires after 24 h, so it is copied into our storage right away). Runs in the
// worker, never in a request. The key only travels in the Authorization header.

export const MODELARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

export type ByteplusVideoConfig = {
  apiKey: string;
  model: string;
  onKeyRejected?: () => Promise<void>;
  /** Overridable for tests. */
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const POLL_INTERVAL_MS = 5_000;
// A 30 s 1080p clip can queue behind others on the account (3 concurrent tasks on individual plans).
const TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

type Task = {
  id?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  content?: { video_url?: string };
  error?: { code?: string; message?: string } | null;
};

type ApiErrorBody = { error?: { code?: string; message?: string } };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** ModelArk error codes and HTTP status → our stable codes. Messages never leave the server. */
export function modelArkError(status: number, code = ""): ProviderError {
  if (/Sensitive|Moderation|RiskControl/i.test(code)) return new ProviderError("content_rejected");
  if (/Overdue|Quota|Balance|InsufficientFunds|InvalidAccountStatus/i.test(code) || status === 402) return new ProviderError("no_credits");
  if (/ModelNotOpen|ModelNotFound|InvalidEndpointOrModel|NotSupported/i.test(code) || status === 404) return new ProviderError("unsupported");
  if (/RateLimit|ServerOverloaded|ConcurrencyLimit|TooManyRequests/i.test(code) || status === 429) return new ProviderError("rate_limited");
  if (/Authentication|InvalidApiKey|AccessDenied|Unauthorized/i.test(code) || status === 401 || status === 403) return new ProviderError("invalid_key");
  return new ProviderError("generation_failed");
}

export function createByteplusVideoProvider(config: ByteplusVideoConfig): VideoProvider {
  const headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${MODELARK_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network trouble or a slow API: worth another go later rather than a failed job.
      throw new ProviderError("rate_limited", "unreachable");
    }
    const json = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
    if (!response.ok) {
      const error = modelArkError(response.status, json.error?.code);
      if (error.code === "invalid_key") await config.onKeyRejected?.().catch(() => undefined);
      throw error;
    }
    return json;
  }

  return {
    id: "byteplus",
    model: config.model,

    async generateVideo(request): Promise<GeneratedVideo> {
      const content: unknown[] = [{ type: "text", text: videoPrompt(request) }];
      if (request.startFrame) {
        const base64 = Buffer.from(request.startFrame.bytes).toString("base64");
        content.push({ type: "image_url", image_url: { url: `data:${request.startFrame.mimeType};base64,${base64}` }, role: "first_frame" });
      }
      const created = await call<Task>("POST", "/contents/generations/tasks", {
        model: config.model,
        content,
        // With a first frame the clip keeps the image's shape ("adaptive"), as ModelArk requires.
        ratio: request.startFrame ? "adaptive" : request.aspectRatio,
        duration: request.seconds,
        resolution: request.resolution,
        generate_audio: true,
        watermark: false,
      });
      if (!created.id) throw new ProviderError("generation_failed");
      const taskPath = `/contents/generations/tasks/${encodeURIComponent(created.id)}`;

      const deadline = Date.now() + (config.timeoutMs ?? TIMEOUT_MS);
      for (;;) {
        await wait(config.pollIntervalMs ?? POLL_INTERVAL_MS);
        const task = await call<Task>("GET", taskPath);
        if (task.status === "succeeded") {
          const url = task.content?.video_url;
          if (!url) throw new ProviderError("generation_failed");
          return { bytes: await downloadVideo(url), mimeType: "video/mp4", provider: "byteplus", model: config.model };
        }
        if (task.status === "failed") throw modelArkError(200, task.error?.code);
        if (task.status === "cancelled" || task.status === "expired") throw new ProviderError("generation_failed");
        if (Date.now() > deadline) {
          // Stop paying for a clip nobody will collect.
          await call("DELETE", taskPath).catch(() => undefined);
          throw new ProviderError("generation_failed", "timeout");
        }
      }
    },
  };
}
