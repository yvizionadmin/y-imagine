import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelsFor, providersFor, textModelsFor, videoModelsFor } from "@/lib/ai/models";
import type { VideoRequest } from "@/lib/ai/types";
import { fitsCapabilities, videoCapabilities, videoModelName } from "@/lib/ai/video-models";

// Kling on its own task API, stubbed (no network). Checks the two request shapes, polling to a
// result, the download, and how Kling's failures map to our error codes.

const downloads: string[] = [];
const safeFetchStub = vi.fn(async (url: string) => {
  downloads.push(url);
  return { ok: true, result: { bytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4", url: new URL(url) } } as unknown;
});
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: (url: string, options: unknown) => (safeFetchStub as (u: string, o: unknown) => Promise<unknown>)(url, options) }));

const { createKlingVideoProvider, klingError, KLING_BASE_URL } = await import("@/lib/ai/providers/kling-video");
const { checkProviderKey } = await import("@/lib/ai/validate-key");

type Call = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[];

/** Answers Kling calls in order: each entry is [status, json]. Then keeps saying "processing". */
function stubKling(responses: [number, unknown][], fallbackId = "t-1") {
  calls = [];
  const queue = [...responses];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const [status, json] = queue.shift() ?? [200, { code: 0, data: [{ id: fallbackId, status: "processing" }] }];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  });
}

const created = (id = "t-1") => [200, { code: 0, data: { id, status: "submitted" } }] as [number, unknown];
const task = (fields: Record<string, unknown>, id = "t-1") => [200, { code: 0, data: [{ id, ...fields }] }] as [number, unknown];
const done = (url = "https://kling-output.example.com/clip.mp4?sig=1") => task({ status: "succeeded", outputs: [{ type: "image", url: "https://x.example.com/i.png" }, { type: "video", url }] });

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  prompt: "A ceramic vase turning slowly on a wooden table",
  aspectRatio: "9:16",
  seconds: 10,
  resolution: "1080p",
  startFrame: null,
  camera: "orbit",
  motion: "low",
  ...over,
});

const provider = (onKeyRejected = vi.fn(async () => undefined)) => createKlingVideoProvider({ apiKey: "kling-test-key-0123456789", model: "kling-3.0", onKeyRejected, pollIntervalMs: 1, timeoutMs: 1_000 });

beforeEach(() => {
  downloads.length = 0;
  safeFetchStub.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Kling video", () => {
  it("creates a text task, polls it and downloads the clip", async () => {
    stubKling([created(), task({ status: "submitted" }), task({ status: "processing" }), done()]);
    const video = await provider().generateVideo(request());

    expect(video).toMatchObject({ mimeType: "video/mp4", provider: "kling", model: "kling-3.0" });
    expect(video.bytes).toEqual(new Uint8Array([1, 2, 3]));
    // The video output, not the first output of any type.
    expect(downloads).toEqual(["https://kling-output.example.com/clip.mp4?sig=1"]);

    const [create, ...polls] = calls;
    expect(`${create.method} ${create.url}`).toBe(`POST ${KLING_BASE_URL}/text-to-video/kling-3.0`);
    expect(create.headers.authorization).toBe("Bearer kling-test-key-0123456789");
    expect(create.body?.settings).toEqual({ resolution: "1080p", duration: 10, aspect_ratio: "9:16", audio: "native", multi_shot: false });
    expect(create.body?.options).toEqual({ watermark_info: { enabled: false } });
    expect(create.body?.prompt).toContain("ceramic vase");
    expect(create.body?.prompt).toContain("orbit");
    expect(polls.map((c) => `${c.method} ${c.url}`)).toEqual(Array(3).fill(`GET ${KLING_BASE_URL}/tasks?task_ids=t-1`));
  });

  it("sends a start frame to the image endpoint, as bare base64 and with no aspect ratio", async () => {
    stubKling([created(), done()]);
    await provider().generateVideo(request({ startFrame: { bytes: new Uint8Array([9, 9]), mimeType: "image/png", name: "f" } }));
    const { url, body } = calls[0];
    expect(url).toBe(`${KLING_BASE_URL}/image-to-video/kling-3.0`);
    expect(body?.prompt).toBeUndefined();
    const contents = body?.contents as { type: string; text?: string; url?: string }[];
    expect(contents[0].type).toBe("prompt");
    expect(contents[0].text).toContain("first frame");
    expect(contents[1]).toEqual({ type: "first_frame", url: "CQk=" });
    expect(body?.settings).toEqual({ resolution: "1080p", duration: 10, audio: "native", multi_shot: false });
  });

  it("converts a WebP start frame, which Kling doesn't take", async () => {
    const webp = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#884422" } }).webp().toBuffer();
    stubKling([created(), done()]);
    await provider().generateVideo(request({ startFrame: { bytes: new Uint8Array(webp), mimeType: "image/webp", name: "f" } }));
    const frame = (calls[0].body?.contents as { url?: string }[])[1].url!;
    expect((await sharp(Buffer.from(frame, "base64")).metadata()).format).toBe("png");
  });

  it("marks a rejected key invalid", async () => {
    stubKling([[401, { code: 1002, message: "Authorization is invalid" }]]);
    const onKeyRejected = vi.fn(async () => undefined);
    await expect(provider(onKeyRejected).generateVideo(request())).rejects.toMatchObject({ code: "invalid_key" });
    expect(onKeyRejected).toHaveBeenCalledOnce();
  });

  it("treats an empty balance as no credits although Kling sends it as 429", async () => {
    stubKling([[429, { code: 1102, message: "package used up" }]]);
    const onKeyRejected = vi.fn(async () => undefined);
    await expect(provider(onKeyRejected).generateVideo(request())).rejects.toMatchObject({ code: "no_credits" });
    expect(onKeyRejected).not.toHaveBeenCalled();
  });

  it("honours an error code on a 200 reply", async () => {
    stubKling([[200, { code: 1301, message: "content" }]]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("keeps polling through passing failures, so a retry doesn't pay for a second clip", async () => {
    stubKling([created(), [429, { code: 1302 }], [503, { code: 5001 }], task({ status: "processing" }), done()]);
    await expect(provider().generateVideo(request())).resolves.toMatchObject({ provider: "kling" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(downloads).toHaveLength(1);
  });

  it("stops polling when the key stops working", async () => {
    stubKling([created(), [401, { code: 1004 }]]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("reports failed tasks, by what the message says", async () => {
    stubKling([created(), task({ status: "failed", message: "Triggered the content risk control of the platform" })]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "content_rejected" });

    stubKling([created(), task({ status: "failed", message: "Internal render error" })]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });

    stubKling([created(), task({ status: "succeeded", outputs: [] })]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });
    expect(downloads).toHaveLength(0);
  });

  it("gives up after the time limit, ignoring other tasks in the reply", async () => {
    stubKling([created(), task({ status: "succeeded", outputs: [{ type: "video", url: "https://x.example.com/other.mp4" }] }, "someone-else")]);
    const slow = createKlingVideoProvider({ apiKey: "kling-test-key-0123456789", model: "kling-3.0", pollIntervalMs: 5, timeoutMs: 20 });
    await expect(slow.generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });
    expect(downloads).toHaveLength(0);
  });

  it("fails when the create reply has no task id", async () => {
    stubKling([[200, { code: 0, data: {} }]]);
    await expect(provider().generateVideo(request())).rejects.toMatchObject({ code: "generation_failed" });
  });

  it("maps Kling's service codes", () => {
    for (const [status, code, expected] of [
      [401, 1000, "invalid_key"],
      [401, 1004, "invalid_key"],
      [429, 1100, "no_credits"],
      [429, 1101, "no_credits"],
      [403, 1103, "unsupported"],
      [404, 1203, "unsupported"],
      [400, 1201, "generation_failed"],
      [400, 1300, "content_rejected"],
      [429, 1302, "rate_limited"],
      [429, 1303, "rate_limited"],
      [429, 1304, "generation_failed"],
      [500, 5000, "generation_failed"],
      [504, 5002, "rate_limited"],
    ] as const) {
      expect(klingError(status, code).code, `${code}`).toBe(expected);
    }
    // A reply with no service code falls back on the HTTP status.
    expect(klingError(401).code).toBe("invalid_key");
    expect(klingError(429).code).toBe("rate_limited");
    expect(klingError(500).code).toBe("generation_failed");
  });
});

describe("checking a Kling key", () => {
  const reply = (over: Record<string, unknown>) => safeFetchStub.mockImplementationOnce(async () => over);

  it("sends the key only in the header", async () => {
    reply({ ok: true, result: { bytes: new TextEncoder().encode('{"code":0,"data":[]}') } });
    expect(await checkProviderKey("kling", "kling-secret-key")).toEqual({ ok: true, models: null });
    const [url, options] = safeFetchStub.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${KLING_BASE_URL}/tasks?task_ids=0`);
    expect(url).not.toContain("kling-secret-key");
    expect(options.headers.authorization).toBe("Bearer kling-secret-key");
  });

  it("accepts a refused task id and rejects a bad key", async () => {
    reply({ ok: false, error: "http_error", status: 400 });
    expect(await checkProviderKey("kling", "k")).toEqual({ ok: true, models: null });
    reply({ ok: false, error: "http_error", status: 401 });
    expect(await checkProviderKey("kling", "k")).toEqual({ ok: false, error: "invalid_key" });
    reply({ ok: false, error: "http_error", status: 500 });
    expect(await checkProviderKey("kling", "k")).toEqual({ ok: false, error: "provider_error" });
  });
});

describe("Kling models and capabilities", () => {
  it("is a video-only provider, tried after the others", () => {
    expect(videoModelsFor("kling", null)).toEqual(["kling-3.0"]);
    expect(textModelsFor("kling", null)).toEqual([]);
    expect(providersFor("video")).toEqual(["gemini", "byteplus", "kling"]);
    expect(modelsFor("video", "kling", null)).toEqual(["kling-3.0"]);
    expect(modelsFor("copy", "kling", null)).toEqual([]);
  });

  it("names the model and offers only what Kling 3.0 takes", () => {
    expect(videoModelName("kling-3.0")).toBe("Kling 3.0");
    const caps = videoCapabilities("kling-3.0");
    expect(caps.aspectRatios).toEqual(["16:9", "9:16", "1:1"]);
    expect(caps.resolutions).toEqual(["720p", "1080p"]);
    expect(Math.min(...caps.durations)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...caps.durations)).toBeLessThanOrEqual(15);
    expect(videoCapabilities("kling-3.5")).toBe(caps);
    expect(fitsCapabilities(caps, { aspectRatio: "9:16", seconds: 10, resolution: "1080p", hasStartFrame: true })).toBe(true);
    expect(fitsCapabilities(caps, { aspectRatio: "21:9", seconds: 10, resolution: "1080p", hasStartFrame: false })).toBe(false);
    expect(fitsCapabilities(caps, { aspectRatio: "16:9", seconds: 20, resolution: "720p", hasStartFrame: false })).toBe(false);
    expect(fitsCapabilities(caps, { aspectRatio: "16:9", seconds: 5, resolution: "480p", hasStartFrame: false })).toBe(false);
  });
});
