import { describe, expect, it, vi } from "vitest";
import { uploadBackgroundId } from "@/features/looks/config";
import { insertLook } from "@/lib/looks/looks";
import { getAsset, saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// B6: deleting a look also deletes the background the merchant uploaded for it, once no duplicate uses it.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { deleteLook } = await import("@/features/looks/actions");

async function signedIn() {
  const made = await makeOrg();
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "editor", plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made.org.id;
}

const png = new Uint8Array([137, 80, 78, 71]);

async function look(orgId: string, backgroundId: string | null) {
  const resultAssetId = await saveAsset(orgId, png, "image/png", "look");
  return insertLook({ orgId, title: "L", prompt: "", style: null, aspectRatio: "1:1", backgroundId, roomType: null, category: "furniture", subcategory: null, items: [], resultAssetId, isBoard: false, createdBy: "t" });
}

describe("deleting a look", () => {
  it("deletes its uploaded background with the last look that uses it", async () => {
    const orgId = await signedIn();
    const background = await saveAsset(orgId, png, "image/webp", "look-background");
    const first = await look(orgId, uploadBackgroundId(background));
    const duplicate = await look(orgId, uploadBackgroundId(background));

    expect(await deleteLook(first.id)).toEqual({ ok: true });
    expect(await getAsset(orgId, first.resultAssetId)).toBeNull();
    expect(await getAsset(orgId, background)).not.toBeNull(); // the duplicate still shows it

    expect(await deleteLook(duplicate.id)).toEqual({ ok: true });
    expect(await getAsset(orgId, background)).toBeNull();
  });

  it("keeps library backgrounds", async () => {
    const orgId = await signedIn();
    const made = await look(orgId, "scene:livingRoom");
    expect(await deleteLook(made.id)).toEqual({ ok: true });
    expect(await getAsset(orgId, made.resultAssetId)).toBeNull();
  });

  it("viewers can't delete", async () => {
    const orgId = await signedIn();
    const background = await saveAsset(orgId, png, "image/webp", "look-background");
    const made = await look(orgId, uploadBackgroundId(background));
    workspace = { ...workspace, role: "viewer" };
    expect(await deleteLook(made.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await getAsset(orgId, background)).not.toBeNull();
  });
});
