import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { listProviderKeys, saveProviderKey } from "@/lib/ai/provider-keys";
import { getEdit } from "@/lib/editor/edits";
import { probeMedia, runFfmpeg } from "@/lib/editor/ffmpeg";
import { runEditRender } from "@/lib/editor/runner";
import { EMPTY_TIMELINE } from "@/lib/editor/timeline";
import { getPlatformSettings, savePlatformSettings } from "@/lib/platform/settings";
import { getAsset, getAssetRecord } from "@/lib/storage/assets";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// B12: voice-over and music generated into a video editor project (one job each, paid plans), used
// as its tracks and rendered into the export.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/editor/queue", () => ({ dispatchEditRender: async () => undefined }));

const actions = await import("@/features/editor/actions");

let dir: string;
let mp3: Uint8Array;
let clip: Uint8Array;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "editor-audio-"));
  await runFfmpeg(["-f", "lavfi", "-i", "sine=f=330:d=2", "-y", path.join(dir, "tone.mp3")]);
  await runFfmpeg(["-f", "lavfi", "-i", "testsrc=s=320x240:d=4:r=25", "-c:v", "libx264", "-y", path.join(dir, "clip.mp4")]);
  mp3 = new Uint8Array(await readFile(path.join(dir, "tone.mp3")));
  clip = new Uint8Array(await readFile(path.join(dir, "clip.mp4")));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function signedIn(plan: "pro" | "free" = "pro", role: Workspace["role"] = "admin") {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

async function newProject() {
  const created = await actions.createEditorProject({ name: "Sound test" });
  if (!created.ok) throw new Error(created.error);
  return created.project;
}

describe("editor audio (demo provider)", () => {
  it("generates a voice-over and music into the project, charges each as its own job, and renders them", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await signedIn();
    const project = await newProject();

    const voice = await actions.generateEditorAudio(project.id, { kind: "voice", text: "Meet the new sofa. Soft, deep and made to last.", voice: "warm", direction: "friendly" });
    if (!voice.ok) throw new Error(voice.error);
    expect(voice.media).toMatchObject({ kind: "audio", source: "voice", mimeType: "audio/wav", name: "Meet the new sofa. Soft, deep and made to last." });
    expect(voice.media.seconds).toBeGreaterThan(2);
    expect(voice.media.url).toBe(`/api/assets/${voice.media.assetId}`);
    expect((await getAssetRecord(made.org.id, voice.media.assetId))?.kind).toBe("editor-media");

    const music = await actions.generateEditorAudio(project.id, { kind: "music", prompt: "Calm acoustic guitar" });
    if (!music.ok) throw new Error(music.error);
    expect(music.media).toMatchObject({ source: "music", name: "Calm acoustic guitar" });
    expect(music.media.seconds).toBeCloseTo(12, 0);

    expect((await listUsage(made.org.id)).map((u) => [u.feature, u.ok, u.credits])).toEqual([
      ["voice", true, 1],
      ["music", true, 2],
    ]);
    expect(await creditsUsedSince(made.org.id, startOfMonth())).toBe(3);

    // Both become tracks; the export has sound all the way and the voice in it.
    const studioClip = await actions.createEditorProject({ name: "x" }); // a second project can't lend its files
    if (!studioClip.ok) throw new Error();
    const uploadForm = new FormData();
    uploadForm.set("editId", project.id);
    uploadForm.set("kind", "clip");
    uploadForm.set("file", new File([clip.slice()], "clip.mp4", { type: "video/mp4" }));
    const { POST } = await import("@/app/api/editor/uploads/route");
    const uploaded = (await (await POST(new Request("http://app.test/api/editor/uploads", { method: "POST", body: uploadForm }))).json()) as { media: { assetId: string } };
    const timeline = {
      ...EMPTY_TIMELINE,
      aspectRatio: "16:9" as const,
      clips: [{ id: "c1", assetId: uploaded.media.assetId, name: "clip", start: 0, end: 4 }],
      audio: { assetId: music.media.assetId, name: music.media.name, volume: 0.3 },
      voice: { assetId: voice.media.assetId, name: voice.media.name, volume: 1, start: 0.5 },
    };
    const saved = await actions.saveEditorProject(project.id, { name: "Sound test", timeline });
    expect(saved.ok).toBe(true);
    // Another project's sound can't be used here.
    expect(await actions.saveEditorProject(studioClip.project.id, { name: "x", timeline })).toEqual({ ok: false, error: "invalid_input" });

    expect((await actions.exportEditorProject(project.id)).ok).toBe(true);
    expect(await runEditRender(made.org.id, project.id)).toBe("done");
    const edit = await getEdit(made.org.id, project.id);
    const out = await getAsset(made.org.id, edit!.outputAssetId!);
    const file = path.join(dir, "out.mp4");
    await writeFile(file, new Uint8Array(out!.bytes));
    expect(await probeMedia(file)).toMatchObject({ hasVideo: true, hasAudio: true });
    expect((await probeMedia(file))!.duration).toBeCloseTo(4, 0);
  });

  it("checks the request, the role and the plan; switched-off or plan-removed sound is refused before any provider", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await signedIn();
    const project = await newProject();
    expect(await actions.generateEditorAudio(project.id, { kind: "voice", text: " ", voice: "warm" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.generateEditorAudio(project.id, { kind: "voice", text: "Hi", voice: "loud" as never })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "x".repeat(301) })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.generateEditorAudio("nope", { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "not_found" });
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "please FAIL" })).toEqual({ ok: false, error: "generation_failed" });

    workspace = { ...workspace, role: "viewer" };
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "forbidden" });
    workspace = { ...workspace, role: "admin" };

    const before = await getPlatformSettings();
    try {
      await savePlatformSettings({ ...before, disabledFeatures: [...before.disabledFeatures, "music"] }, "test");
      expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "feature_disabled" });
      expect((await actions.getEditorSetup()).audio).toEqual({ voice: null, music: "feature_disabled" });
      const rules = before.creditRules;
      await savePlatformSettings({ ...before, creditRules: { ...rules, planFeatures: { ...rules.planFeatures, pro: rules.planFeatures.pro.filter((f) => f !== "voice") } } }, "test");
      expect(await actions.generateEditorAudio(project.id, { kind: "voice", text: "Hi", voice: "calm" })).toEqual({ ok: false, error: "not_in_plan" });
      expect((await actions.getEditorSetup()).audio.voice).toBe("not_in_plan");
    } finally {
      await savePlatformSettings(before, "test");
    }

    await signedIn("free");
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "not_in_plan" });
  });

  it("without a key (demo off) says which key is missing and charges nothing", async () => {
    const made = await signedIn();
    const project = await newProject();
    expect((await actions.getEditorSetup()).audio).toEqual({ voice: "no_provider", music: "no_provider" });
    expect(await actions.generateEditorAudio(project.id, { kind: "voice", text: "Hi", voice: "calm" })).toEqual({ ok: false, error: "no_provider" });
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });
});

describe("editor audio (real providers, HTTP stubbed)", () => {
  type Call = { url: string; headers: Headers; body: string };
  let calls: Call[] = [];
  const stub = (respond: (call: Call) => Response) =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : "" };
      calls.push(call);
      return respond(call);
    });
  afterEach(() => {
    calls = [];
  });

  it("OpenAI reads the script with the chosen voice and directions (MP3)", async () => {
    const made = await signedIn();
    const project = await newProject();
    await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-5", "gpt-4o-mini-tts"], createdBy: "t" });
    stub(() => new Response(mp3.slice(), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const result = await actions.generateEditorAudio(project.id, { kind: "voice", text: "Hello there", voice: "deep", direction: "slow and warm" });
    if (!result.ok) throw new Error(result.error);
    expect(result.media).toMatchObject({ mimeType: "audio/mpeg", source: "voice" });
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(calls[0].body)).toMatchObject({ model: "gpt-4o-mini-tts", input: "Hello there", voice: "onyx", instructions: "slow and warm", response_format: "mp3" });
    expect((await listUsage(made.org.id))[0]).toMatchObject({ feature: "voice", provider: "openai", model: "gpt-4o-mini-tts", ok: true });
  });

  it("Gemini speaks with its TTS model (PCM wrapped as WAV) and makes music with Lyria", async () => {
    const made = await signedIn();
    const project = await newProject();
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash", "gemini-2.5-flash-preview-tts", "lyria-3-clip-preview"], createdBy: "t" });
    // One second of 24 kHz 16-bit mono PCM (a tone).
    const pcm = Buffer.alloc(48_000);
    for (let i = 0; i < 24_000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24_000)), i * 2);
    stub((call) =>
      call.url.endsWith("/interactions")
        ? Response.json({ id: "i1", status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/mpeg", data: Buffer.from(mp3).toString("base64") }] }] })
        : Response.json({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] }, finishReason: "STOP" }] }),
    );

    const voice = await actions.generateEditorAudio(project.id, { kind: "voice", text: "مرحبا بكم", voice: "bright", direction: "" });
    if (!voice.ok) throw new Error(voice.error);
    expect(voice.media).toMatchObject({ mimeType: "audio/wav" });
    expect(voice.media.seconds).toBeCloseTo(1, 1);
    expect(calls[0].url).toContain("/models/gemini-2.5-flash-preview-tts:generateContent");
    expect(calls[0].body).toContain("Puck");

    const music = await actions.generateEditorAudio(project.id, { kind: "music", prompt: "Upbeat pop for a summer sale" });
    if (!music.ok) throw new Error(music.error);
    expect(music.media).toMatchObject({ mimeType: "audio/mpeg", source: "music" });
    const lyria = calls[1];
    expect(lyria.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(lyria.headers.get("x-goog-api-key")).toBe("AIza-test-000000000000000");
    expect(JSON.parse(lyria.body)).toMatchObject({ model: "lyria-3-clip-preview", response_format: [{ type: "audio", mime_type: "audio/mpeg" }], store: false });
    expect(lyria.body).toContain("Upbeat pop for a summer sale");
    expect((await listUsage(made.org.id)).map((u) => [u.feature, u.provider, u.model])).toEqual([
      ["voice", "gemini", "gemini-2.5-flash-preview-tts"],
      ["music", "gemini", "lyria-3-clip-preview"],
    ]);
  });

  it("maps Lyria's failures: a rejected key is marked invalid, a safety refusal is content_rejected", async () => {
    const made = await signedIn();
    const project = await newProject();
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["lyria-3-clip-preview"], createdBy: "t" });
    stub(() => new Response(JSON.stringify({ error: { code: 400, message: "Prompt was blocked: PROHIBITED_CONTENT", status: "INVALID_ARGUMENT" } }), { status: 400 }));
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "content_rejected" });
    stub(() => new Response(JSON.stringify({ error: { code: 403, message: "API key not valid", status: "PERMISSION_DENIED" } }), { status: 403 }));
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "invalid_key" });
    expect((await listProviderKeys(made.org.id)).find((k) => k.provider === "gemini")?.status).toBe("invalid");
    // An answer without audio is a failed job, not a crash.
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000001", models: ["lyria-3-clip-preview"], createdBy: "t" });
    stub(() => Response.json({ id: "i2", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Sorry" }] }] }));
    expect(await actions.generateEditorAudio(project.id, { kind: "music", prompt: "calm" })).toEqual({ ok: false, error: "generation_failed" });
    expect((await listUsage(made.org.id)).every((u) => !u.ok)).toBe(true);
  });
});
