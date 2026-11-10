import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProvider } from "@/lib/ai/providers/demo";
import type { CreateImageRequest } from "@/lib/ai/types";
import { listAudit } from "@/lib/audit";
import { insertUser } from "@/lib/auth/users";
import { getCharacter } from "@/lib/characters/characters";
import { advanceDirector } from "@/lib/director/advance";
import { DEFAULT_DIRECTOR_SETTINGS, type DirectorSettings } from "@/lib/director/limits";
import { getDirector } from "@/lib/director/projects";
import { runEditRender } from "@/lib/editor/runner";
import { getAssetRecord } from "@/lib/storage/assets";
import { ensureMembership } from "@/lib/team/members";
import { listUsage } from "@/lib/usage";
import { getVideoJobs } from "@/lib/video/jobs";
import { runVideoJob } from "@/lib/video/runner";
import type { Workspace } from "@/lib/workspace";
import { makeOrg, uniqueEmail } from "../helpers";

// B13: saved characters (photos with consent, or an AI portrait) and the AI Director keeping one
// character the same in every scene.

let workspace: Workspace;
const queued = { director: [] as string[], video: [] as string[], render: [] as string[] };
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/director/queue", () => ({ dispatchDirector: async (_o: string, id: string) => void queued.director.push(id) }));
vi.mock("@/lib/video/queue", () => ({ dispatchVideoJob: async (_o: string, id: string) => void queued.video.push(id) }));
vi.mock("@/lib/editor/queue", () => ({ dispatchEditRender: async (_o: string, id: string) => void queued.render.push(id) }));

const characters = await import("@/features/characters/actions");
const director = await import("@/features/director/actions");

beforeEach(() => {
  queued.director.length = queued.video.length = queued.render.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
  vi.stubEnv("DEMO_VIDEO_LATENCY_MS", "0");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"] = "admin", user: { id: string; name: string; email: string } = made.user) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: user.id, name: user.name, email: user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

const photo = async (name = "layla.png") => new File([new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", "sofa-source.png")))], name, { type: "image/png" });
async function photosForm(fields: { name?: string; description?: string; consent?: boolean; files?: File[] }) {
  const form = new FormData();
  form.set("name", fields.name ?? "Layla");
  form.set("description", fields.description ?? "woman in her 30s, short black hair, mustard sweater");
  for (const file of fields.files ?? [await photo(), await photo("layla-2.png")]) form.append("images", file);
  if (fields.consent ?? true) form.set("consent", "yes");
  return form;
}

async function drain(orgId: string) {
  for (let round = 0; round < 20; round++) {
    const ids = { d: queued.director.splice(0), v: queued.video.splice(0), r: queued.render.splice(0) };
    if (!ids.d.length && !ids.v.length && !ids.r.length) return;
    for (const id of new Set(ids.d)) await advanceDirector(orgId, id);
    for (const id of ids.v) await runVideoJob(orgId, id);
    for (const id of ids.r) await runEditRender(orgId, id);
  }
  throw new Error("still working");
}

describe("characters", () => {
  it("saves a character from photos only with consent, recorded and audited", async () => {
    const made = await makeOrg();
    as(made);
    expect(await characters.createCharacterFromPhotos(await photosForm({ consent: false }))).toEqual({ ok: false, error: "consent_required" });
    expect(await characters.createCharacterFromPhotos(await photosForm({ files: [] }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await characters.createCharacterFromPhotos(await photosForm({ files: [new File(["x"], "a.gif", { type: "image/gif" })] }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await characters.createCharacterFromPhotos(await photosForm({ name: " " }))).toEqual({ ok: false, error: "invalid_input" });

    const saved = await characters.createCharacterFromPhotos(await photosForm({}));
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.character).toMatchObject({ name: "Layla", source: "upload", canDelete: true });
    expect(saved.character.images).toHaveLength(2);
    expect(saved.character.consentedAt).not.toBeNull();
    expect((await getAssetRecord(made.org.id, saved.character.images[0].assetId))?.kind).toBe("character");
    const [audit] = await listAudit(made.org.id, { prefix: "character." });
    expect(audit).toMatchObject({ action: "character.consent_given", target: "Layla", actor: made.user.name });
    expect(await listUsage(made.org.id)).toHaveLength(0); // uploads cost nothing
  });

  it("generates an AI portrait from a description (one image job, no consent needed)", async () => {
    const made = await makeOrg();
    as(made);
    const spy = vi.spyOn(demoProvider, "createImage");
    expect(await characters.createCharacterFromDescription({ name: "Omar", description: "short" })).toEqual({ ok: false, error: "invalid_input" });
    const saved = await characters.createCharacterFromDescription({ name: "Omar", description: "friendly man in his 40s, grey beard, round glasses" });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.character).toMatchObject({ source: "generated", consentedAt: null });
    expect(spy.mock.calls[0][0].prompt).toContain("fictional person, friendly man in his 40s, grey beard, round glasses");
    expect((await listUsage(made.org.id)).map((u) => u.feature)).toEqual(["create"]);
  });

  it("only its creator or an admin deletes it; viewers and other orgs can't touch it", async () => {
    const made = await makeOrg();
    as(made);
    const saved = await characters.createCharacterFromPhotos(await photosForm({}));
    if (!saved.ok) throw new Error(saved.error);
    const editor = await insertUser({ name: "Editor", email: uniqueEmail(), password: "test-password-1", createdBy: "t" });
    await ensureMembership({ orgId: made.org.id, userId: editor.id, name: editor.name, email: editor.email, role: "editor", invitedBy: null });
    as(made, "editor", editor);
    expect((await characters.getCharacters()).characters[0].canDelete).toBe(false);
    expect(await characters.deleteCharacter(saved.character.id)).toEqual({ ok: false, error: "forbidden" });
    as(made, "viewer");
    expect(await characters.getCharacters()).toMatchObject({ canEdit: false, characters: [{ id: saved.character.id, canDelete: false }] });
    expect(await characters.createCharacterFromPhotos(await photosForm({}))).toEqual({ ok: false, error: "forbidden" });
    as(await makeOrg());
    expect(await characters.getCharacters()).toMatchObject({ characters: [] });
    expect(await characters.deleteCharacter(saved.character.id)).toEqual({ ok: false, error: "not_found" });

    as(made);
    expect(await characters.deleteCharacter(saved.character.id)).toEqual({ ok: true });
    expect(await getCharacter(made.org.id, saved.character.id)).toBeNull();
    expect(await getAssetRecord(made.org.id, saved.character.images[0].assetId)).toBeNull();
    expect((await listAudit(made.org.id, { prefix: "character." }))[0].action).toBe("character.deleted");
  });
});

describe("AI Director with a character (B13 done when)", () => {
  const settings = (patch: Partial<DirectorSettings> = {}): DirectorSettings => ({ ...DEFAULT_DIRECTOR_SETTINGS, aspectRatio: "16:9", seconds: 4, scenes: 3, voiceOver: false, ...patch });

  it("puts the same character in every scene: in the script, from their reference images, with their consent", async () => {
    const made = await makeOrg();
    as(made);
    const saved = await characters.createCharacterFromPhotos(await photosForm({}));
    if (!saved.ok) throw new Error(saved.error);
    const stored = await getCharacter(made.org.id, saved.character.id);
    const images: CreateImageRequest[] = [];
    const real = demoProvider.createImage.bind(demoProvider);
    vi.spyOn(demoProvider, "createImage").mockImplementation(async (request) => (images.push(request), real(request)));

    const created = await director.createDirectorProject({ idea: "Layla's slow Sunday morning with our oak chair", settings: settings(), characterId: saved.character.id });
    if (!created.ok) throw new Error(created.error);
    expect(created.project.settings.character).toEqual({ id: saved.character.id, name: "Layla", description: "woman in her 30s, short black hair, mustard sweater" });
    await drain(made.org.id);

    const done = await getDirector(made.org.id, created.project.id);
    expect(done?.status).toBe("done");
    // The script names her, the same way, in every scene.
    for (const scene of done!.scenes) expect(scene.visual).toContain("Featuring Layla, woman in her 30s, short black hair, mustard sweater.");
    // Every storyboard image was made from her two reference photos, with the instruction to keep her look.
    expect(images).toHaveLength(3);
    for (const request of images) {
      expect(request.references.map((r) => r.name)).toEqual(["Layla-1", "Layla-2"]);
      expect(request.prompt).toContain("Keep Layla exactly as in the reference images");
    }
    // Each scene video starts from that frame and carries the consent given for her photos; motion follows the script.
    const jobs = await getVideoJobs(made.org.id, done!.scenes.map((s) => s.videoJobId!));
    expect(jobs.map((j) => j.consentedAt)).toEqual(Array(3).fill(stored!.consentedAt));
    expect(new Set(jobs.map((j) => j.settings.motion))).toEqual(new Set(["low", "medium", "high"]));
  });

  it("an AI character carries no consent; a deleted character falls back to the description; other orgs' characters are refused", async () => {
    const made = await makeOrg();
    as(made);
    const ai = await characters.createCharacterFromDescription({ name: "Omar", description: "friendly man in his 40s, grey beard" });
    if (!ai.ok) throw new Error(ai.error);
    const created = await director.createDirectorProject({ idea: "Omar unboxes a lamp", settings: settings({ scenes: 2 }), characterId: ai.character.id });
    if (!created.ok) throw new Error(created.error);
    await drain(made.org.id);
    const done = await getDirector(made.org.id, created.project.id);
    expect((await getVideoJobs(made.org.id, done!.scenes.map((s) => s.videoJobId!))).every((j) => j.consentedAt === null)).toBe(true);

    // Deleted after the project started: the storyboard uses the kept name and look, without images.
    const second = await director.createDirectorProject({ idea: "Omar again", settings: settings({ scenes: 2 }), characterId: ai.character.id });
    if (!second.ok) throw new Error(second.error);
    await characters.deleteCharacter(ai.character.id);
    const images: CreateImageRequest[] = [];
    const real = demoProvider.createImage.bind(demoProvider);
    vi.spyOn(demoProvider, "createImage").mockImplementation(async (request) => (images.push(request), real(request)));
    await drain(made.org.id);
    expect((await getDirector(made.org.id, second.project.id))?.status).toBe("done");
    expect(images.every((r) => r.references.length === 0 && !r.prompt.includes("Keep Omar"))).toBe(true);

    const other = await makeOrg();
    as(other);
    expect(await director.createDirectorProject({ idea: "x", settings: settings(), characterId: ai.character.id })).toEqual({ ok: false, error: "invalid_input" });
    expect((await director.getDirectorSetup()).characters).toEqual([]);
  });
});
