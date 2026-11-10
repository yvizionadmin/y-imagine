import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProvider } from "@/lib/ai/providers/demo";
import { insertRoomBackground, listRoomBackgrounds, updateRoomBackground } from "@/lib/looks/room-backgrounds";
import { saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// B6: team scenes are the org's Room Backgrounds, saved from Generate and offered there per category.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { listTeamScenes, saveTeamScene } = await import("@/features/scenes/actions");
const { generateLifestyleImage } = await import("@/features/generate/actions");

async function signedIn(role: Workspace["role"] = "editor") {
  const made = await makeOrg();
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made.org.id;
}

const png = async (name = "room.png") =>
  new File([new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c8b8a0" } }).png().toBuffer())], name, { type: "image/png" });

async function sceneForm(fields: Record<string, string>, image: File | null = null) {
  const data = new FormData();
  data.set("image", image ?? (await png()));
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function background(orgId: string, category = "furniture") {
  const assetId = await saveAsset(orgId, new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).webp().toBuffer()), "image/webp", "room-background");
  return insertRoomBackground({ orgId, name: "Sea View Terrace", roomType: "outdoor", category, style: "contemporary", assetId, mimeType: "image/webp", active: true });
}

beforeEach(() => vi.stubEnv("IMAGINE_DEMO", "1"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("team scenes", () => {
  it("an editor saves an upload for a category; it is listed there only, with the picked style or the category's first", async () => {
    await signedIn("editor");
    const saved = await saveTeamScene(await sceneForm({ name: "  Showroom corner ", category: "furniture", roomType: "livingRoom", style: "industrial" }));
    expect(saved).toMatchObject({ ok: true, scene: { name: "Showroom corner" } });
    await saveTeamScene(await sceneForm({ name: "Kitchen island", category: "kitchenAppliances", roomType: "kitchen", style: "notAStyle" }));

    // The org's starter backgrounds were seeded first, as a visit to Room Backgrounds would, but
    // they copy built-in scenes, so they aren't team scenes.
    expect((await listRoomBackgrounds(workspace.orgId)).filter((b) => b.starter)).toHaveLength(3);
    const furniture = await listTeamScenes("furniture");
    expect(furniture.canSave).toBe(true);
    expect(furniture.scenes.map((s) => s.name)).toEqual(["Showroom corner"]);
    expect(furniture.scenes[0].imageUrl).toMatch(/^\/api\/assets\//);
    expect((await listTeamScenes("kitchenAppliances")).scenes.map((s) => s.name)).toEqual(["Kitchen island"]);
    expect(await listTeamScenes("notACategory")).toEqual({ scenes: [], canSave: true });
  });

  it("refuses viewers, bad fields and files that aren't images", async () => {
    await signedIn("viewer");
    expect(await saveTeamScene(await sceneForm({ name: "A", category: "furniture", roomType: "livingRoom" }))).toEqual({ ok: false, error: "forbidden" });
    expect((await listTeamScenes("furniture")).canSave).toBe(false);

    await signedIn("editor");
    expect(await saveTeamScene(await sceneForm({ name: "", category: "furniture", roomType: "livingRoom" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveTeamScene(await sceneForm({ name: "A", category: "furniture", roomType: "garage" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveTeamScene(await sceneForm({ name: "A", category: "nope", roomType: "livingRoom" }))).toEqual({ ok: false, error: "invalid_input" });
    const fake = new File(["not a png"], "room.png", { type: "image/png" });
    expect(await saveTeamScene(await sceneForm({ name: "A", category: "furniture", roomType: "livingRoom" }, fake))).toEqual({ ok: false, error: "invalid_input" });
    expect((await listTeamScenes("furniture")).scenes).toEqual([]); // nothing saved, nothing seeded
  });

  it("hidden backgrounds and other orgs' backgrounds are not listed, and listing never seeds starters", async () => {
    const other = await signedIn();
    await background(other);
    const orgId = await signedIn();
    const hidden = await background(orgId);
    await updateRoomBackground(orgId, hidden.id, { active: false });
    expect((await listTeamScenes("furniture")).scenes).toEqual([]);
  });

  it("Generate sends a team scene to the provider as the room to keep, loaded on the server", async () => {
    const orgId = await signedIn();
    const scene = await background(orgId);
    const spy = vi.spyOn(demoProvider, "generateLifestyle");
    const form = async (fields: Record<string, string>) => {
      const data = new FormData();
      data.set("sku", "SOFA-1");
      data.set("product", await png("sofa.png"));
      data.set("category", "furniture");
      data.set("aspectRatio", "1:1");
      data.set("resolution", "HD");
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      return data;
    };

    expect((await generateLifestyleImage(await form({ teamScene: scene.id }))).ok).toBe(true);
    expect(spy.mock.calls[0][0].sceneUpload).toMatchObject({ name: "Sea View Terrace", mimeType: "image/webp" });

    // One scene source only; hidden scenes and another org's ids are refused before any credit.
    expect(await generateLifestyleImage(await form({ teamScene: scene.id, scene: "livingRoom" }))).toEqual({ ok: false, error: "invalid_input" });
    await updateRoomBackground(orgId, scene.id, { active: false });
    expect(await generateLifestyleImage(await form({ teamScene: scene.id }))).toEqual({ ok: false, error: "invalid_input" });
    const otherOrg = await signedIn();
    const theirs = await background(otherOrg);
    workspace = { ...workspace, orgId };
    expect(await generateLifestyleImage(await form({ teamScene: theirs.id }))).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
