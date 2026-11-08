import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelsFor, providersFor, textModelsFor, videoModelsFor } from "@/lib/ai/models";
import { ratioParts, videoCapabilities, videoModelName } from "@/lib/ai/video-models";
import type { VideoRequest } from "@/lib/ai/types";

// Seedance on BytePlus ModelArk: the task API is stubbed (no network). Checks the request we send,
// polling to a result, the download, and how ModelArk failures map to our error codes.

const downloads: string[] = [];
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: async (url: string) => {
    downloads.push(url);
    return { ok: true, result: { bytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4", url: new URL(url) } };
  },
}));

const { createByteplusVideoProvider, modelArkError, MODELARK_BASE_URL } = await import("@/lib/ai/providers/byteplus-video");

type Call = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[];

/** Answers ModelArk calls in order: each entry is [status, json]. */
function stubModelArk(responses: [number, unknown][]) {
  calls = [];
  const queue = [...responses];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const [status, json] = queue.shift() ?? [200, { status: "running" }];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  });
}

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  prompt: "A ceramic vase turning slowly on a wooden table",
  aspectRatio: "1:1",
  seconds: 12,
  resolution: "480p",
  startFrame: null,
  camera: "orbit",
  motion: "low",
  lens: "auto",
  lighting: "auto",
  ...over,
});

const provider = (onKeyRejected = vi.fn(async () => undefined)) =>
  createByteplusVideoProvider({ apiKey: "ark-test-key-0123456789", model: "dreamina-seedance-2-5-260628", onKeyRejected, pollIntervalMs: 1, timeoutMs: 1_000 });

beforeEach(() => void (downloads.length = 0));
afterEach(() => vi.unstubAllGlobals());

describe("Seedance on BytePlus ModelArk", () => {
  it("creates a task, polls it and downloads the clip", async () => {
    stubModelArk([
      [200, { id: "cgt-123" }],
      [200, { id: "cgt-123", status: "queued" }],
      [200, { id: "cgt-123", status: "running" }],
      [200, { id: "cgt-123", status: "succeeded", content: { video_url: "https://ark-output.example.com/clip.mp4?sig=1" } }],
    ]);
    const video = await provider().generateVideo(request());

    expect(video).toMatchObject({ mimeType: "video/mp4", provider: "byteplus", model: "dreamina-seedance-2-5-260628" });
    expect(video.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(downloads).toEqual(["https://ark-output.example.com/clip.mp4?sig=1"]);

    const [create, ...polls] = calls;
    expect(create.method).toBe("POST");
    expect(create.url).toBe(`${MODELARK_BASE_URL}/contents/generations/tasks`);
    expect(create.headers.authorization).toBe("Bearer ark-test-key-0123456789");
    expect(create.body).toMatchObject({ model: "dreamina-seedance-2-5-260628", ratio: "1:1", duration: 12, resolution: "480p", generate_audio: true, watermark: false });
    const content = create.body?.content as { type: string; text?: string }[];
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain("ceramic vase");
    expect(content[0].text).toContain("orbit");
    expect(polls.map((c) => `${c.method} ${c.url}`)).toEqual(Array(3).fill(`GET ${MODELARK_BASE_URL}/contents/generations/tasks/cgt-123`));
  });

  it("sends a start frame as the first frame and lets the clip keep its shape", async () => {
    stubModelArk([
      [200, { id: "cgt-9" }],
      [200, { status: "succeeded", content: { video_url: "https://ark-output.example.com/b.mp4" } }],
    ]);
    await provider().generateVideo(request({ aspectRatio: "16:9", startFrame: { bytes: new Uint8Array([9, 9]), mimeType: "image/png", name: "f" } }));
    expect(calls[0].body).toMatchObject({ ratio: "adaptive" });
    expect((calls[0].body?.content as unknown[])[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,CQk=" }, role: "first_frame" });
  });

  it("holds the camera still with ModelArk's own flag, not prompt text", async () => {
    stubModelArk([
      [200, { id: "cgt-3" }],
      [200, { status: "succeeded", content: { video_url: "https://ark-output.example.com/c.mp4" } }],
    ]);
    await provider().generateVideo(request({ camera: "static" }));
    const text = (calls[0].body?.content as { text: string }[])[0].text;
    expect(text.endsWith(" --camerafixed true")).toBe(true);
    expect(text).not.toContain("Locked-off");
  });

  it("leaves other camera moves in the prompt, with no flag", async () => {
    stubModelArk([
      [200, { id: "cgt-4" }],
      [200, { status: "succeeded", content: { video_url: "https://ark-output.example.com/d.mp4" } }],
    ]);
    await provider().generateVideo(request({ camera: "pan", lens: "macro", lighting: "neon" }));
    const text = (calls[0].body?.content as { text: string }[])[0].text;
    expect(text).not.toContain("--camerafixed");
    expect(text).toContain("Camera: Smooth horizontal pan");
    expect(text).toContain("Lens: Macro lens");
    expect(text).toContain("Lighting: Colourful neon");
  });

  it("marks a rejected key invalid", async () => {
    stubModelArk([[401, { error: { code: "AuthenticationError", message: "bad key" } }]]);
    const onKeyRejected = vi.fn(async () => undefined);
    await expect(provider(onKeyRejected).generateVideo(request())).rejects.toMatchObject({ code: "invalid_key" });
    expect(onKeyRejected).toHaveBeenCalledOnce();
  });

  it("keeps rate limits retryable and reports failed tasks", async () => {
    stubModelArk([[429, { error: { code: "RateLimitExceeded.EndpointRPM" } }]]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "rate_limited" });

    stubModelArk([
      [200, { id: "cgt-1" }],
      [200, { status: "failed", error: { code: "OutputVideoSensitiveContentDetected", message: "x" } }],
    ]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "content_rejected" });

    stubModelArk([
      [200, { id: "cgt-2" }],
      [200, { status: "expired" }],
    ]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });
    expect(downloads).toHaveLength(0);
  });

  it("cancels a task that runs past the time limit", async () => {
    stubModelArk([[200, { id: "cgt-slow" }]]);
    const slow = createByteplusVideoProvider({ apiKey: "ark-test-key-0123456789", model: "dreamina-seedance-2-5-260628", pollIntervalMs: 5, timeoutMs: 20 });
    await expect(slow.generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `${MODELARK_BASE_URL}/contents/generations/tasks/cgt-slow` });
  });

  it("maps ModelArk error codes", () => {
    expect(modelArkError(403, "ModelNotOpen").code).toBe("unsupported");
    expect(modelArkError(403, "AccountOverdueError").code).toBe("no_credits");
    expect(modelArkError(403, "AccessDenied").code).toBe("invalid_key");
    expect(modelArkError(429, "ServerOverloaded").code).toBe("rate_limited");
    expect(modelArkError(400, "InputImageSensitiveContentDetected").code).toBe("content_rejected");
    expect(modelArkError(500).code).toBe("generation_failed");
  });
});

describe("Seedance models and capabilities", () => {
  it("is a video-only provider", () => {
    expect(videoModelsFor("byteplus", null)).toEqual(["dreamina-seedance-2-5-260628"]);
    expect(videoModelsFor("byteplus", ["dreamina-seedance-2-5-260628", "dreamina-seedance-2-0-260128", "seedream-4-0"])).toEqual([
      "dreamina-seedance-2-5-260628",
      "dreamina-seedance-2-0-260128",
    ]);
    expect(textModelsFor("byteplus", null)).toEqual([]);
    // Video has its own model picker: video providers only.
    expect(providersFor("video")).toEqual(["gemini", "byteplus", "kling"]);
    expect(modelsFor("video", "byteplus", null)).toEqual(["dreamina-seedance-2-5-260628"]);
    expect(modelsFor("video", "openai", null)).toEqual([]);
    expect(modelsFor("copy", "byteplus", null)).toEqual([]);
  });

  it("names video models for people", () => {
    expect(videoModelName("dreamina-seedance-2-5-260628")).toBe("Seedance 2.5");
    expect(videoModelName("dreamina-seedance-2-0-fast-260128")).toBe("Seedance 2.0 Fast");
    expect(videoModelName("gemini-omni-1.2-flash")).toBe("Gemini Omni 1.2 Flash");
    expect(videoModelName("something-else")).toBe("something-else");
  });

  it("offers Seedance 2.5's lengths, ratios and resolutions", () => {
    const caps = videoCapabilities("dreamina-seedance-2-5-260628");
    expect(caps.durations).toContain(30);
    expect(caps.aspectRatios).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
    expect(caps.resolutions).toEqual(["480p", "720p", "1080p"]);
    // A newer dated id gets Seedance's options until it is listed; others fall back to Omni Flash.
    expect(videoCapabilities("dreamina-seedance-2-5-261201")).toBe(caps);
    expect(videoCapabilities("gemini-omni-1.3-flash").aspectRatios).toEqual(["16:9", "9:16"]);
    expect(ratioParts("21:9")).toEqual([21, 9]);
    expect(ratioParts("nope")).toEqual([16, 9]);
  });
});
