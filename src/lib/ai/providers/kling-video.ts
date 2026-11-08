import "server-only";
import sharp from "sharp";
import { ProviderError } from "../errors";
import type { GeneratedVideo, VideoProvider, VideoRequest } from "../types";
import { videoPrompt } from "../video-prompt";
import { downloadVideo } from "./video-download";

// Kling on its own API, built per job from the org's decrypted key (BYOK). Video runs as an async
// task: create it, poll /tasks, then copy the clip into our storage (Kling clears results after
// 30 days). The model is part of the path. Runs in the worker, never in a request. The key only
// travels in the Authorization header. Kling documents no way to cancel a task.

export const KLING_BASE_URL = "https://api-singapore.klingai.com";

export type KlingVideoConfig = {
  apiKey: string;
  model: string;
  onKeyRejected?: () => Promise<void>;
  /** Overridable for tests. */
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

type Task = {
  id?: string;
  status?: "submitted" | "processing" | "succeeded" | "failed";
  message?: string;
  outputs?: { type?: string; url?: string }[];
};
type Reply<T> = { code?: number; data?: T };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kling's service codes → our stable codes. The code decides before the HTTP status: an empty
 * balance (1101, 1102) also comes as 429, and retrying won't fix it. Messages never leave the server.
 */
export function klingError(status: number, code = 0): ProviderError {
  if (code >= 1000 && code <= 1004) return new ProviderError("invalid_key");
  if (code >= 1100 && code <= 1102) return new ProviderError("no_credits");
  if (code === 1103 || code === 1202 || code === 1203) return new ProviderError("unsupported");
  if (code === 1300 || code === 1301) return new ProviderError("content_rejected");
  if (code === 1302 || code === 1303 || code === 5001 || code === 5002) return new ProviderError("rate_limited");
  if (code !== 0) return new ProviderError("generation_failed");
  if (status === 401) return new ProviderError("invalid_key");
  if (status === 429 || status === 503 || status === 504) return new ProviderError("rate_limited");
  return new ProviderError("generation_failed");
}

/** Kling takes JPEG or PNG frames, as bare base64. The Studio also accepts WebP. */
async function frameBase64(frame: NonNullable<VideoRequest["startFrame"]>) {
  const bytes = frame.mimeType === "image/png" || frame.mimeType === "image/jpeg" ? frame.bytes : await sharp(frame.bytes).png().toBuffer();
  return Buffer.from(bytes).toString("base64");
}

export function createKlingVideoProvider(config: KlingVideoConfig): VideoProvider {
  const headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T | undefined> {
    let response: Response;
    try {
      response = await fetch(`${KLING_BASE_URL}${path}`, {
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
    const json = (await response.json().catch(() => ({}))) as Reply<T>;
    if (!response.ok || (json.code ?? 0) !== 0) {
      const error = klingError(response.status, json.code);
      if (error.code === "invalid_key") await config.onKeyRejected?.().catch(() => undefined);
      throw error;
    }
    return json.data;
  }

  async function createTask(request: VideoRequest) {
    const prompt = videoPrompt(request);
    const settings = { resolution: request.resolution, duration: request.seconds, audio: "native", multi_shot: false };
    const options = { watermark_info: { enabled: false } };
    if (request.startFrame) {
      // The clip takes its shape from the frame: this endpoint has no aspect ratio.
      const contents = [
        { type: "prompt", text: prompt },
        { type: "first_frame", url: await frameBase64(request.startFrame) },
      ];
      return call<Task>("POST", `/image-to-video/${encodeURIComponent(config.model)}`, { contents, settings, options });
    }
    return call<Task>("POST", `/text-to-video/${encodeURIComponent(config.model)}`, { prompt, settings: { ...settings, aspect_ratio: request.aspectRatio }, options });
  }

  /** One poll. A passing failure must not fail the job: a retry would pay for a second clip. */
  async function readTask(id: string): Promise<Task | undefined> {
    try {
      const tasks = await call<Task[]>("GET", `/tasks?task_ids=${encodeURIComponent(id)}`);
      return tasks?.find((task) => task.id === id);
    } catch (error) {
      if (error instanceof ProviderError && error.code === "rate_limited") return undefined;
      throw error;
    }
  }

  return {
    id: "kling",
    model: config.model,

    async generateVideo(request): Promise<GeneratedVideo> {
      const created = await createTask(request);
      if (!created?.id) throw new ProviderError("generation_failed");

      const deadline = Date.now() + (config.timeoutMs ?? TIMEOUT_MS);
      for (;;) {
        await wait(config.pollIntervalMs ?? POLL_INTERVAL_MS);
        const task = await readTask(created.id);
        if (task?.status === "succeeded") {
          const url = task.outputs?.find((output) => output.type === "video")?.url;
          if (!url) throw new ProviderError("generation_failed");
          return { bytes: await downloadVideo(url), mimeType: "video/mp4", provider: "kling", model: config.model };
        }
        if (task?.status === "failed") {
          // Only a message says why; Kling names its content risk control there.
          throw new ProviderError(/risk|sensitive|violat|moderation|content security/i.test(task.message ?? "") ? "content_rejected" : "generation_failed");
        }
        if (Date.now() > deadline) throw new ProviderError("generation_failed", "timeout");
      }
    },
  };
}
