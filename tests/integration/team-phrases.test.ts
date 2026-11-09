import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/lib/db";
import { insertGeneration, type GenerationMode } from "@/lib/generations";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
const getWorkspace = vi.fn(async (options?: { read: true }) => (void options, workspace));
vi.mock("@/lib/workspace", () => ({ getWorkspace }));

const { listTeamPhrases } = await import("@/features/prompts/actions");

async function asMember(role: Workspace["role"] = "admin") {
  const made = await makeOrg();
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

function save(orgId: string, mode: GenerationMode, settings: Record<string, string | null>) {
  return insertGeneration({ orgId, mode, sku: "SKU-1", title: "T", assetId: "asset", mimeType: "image/png", width: 1, height: 1, settings, provider: "demo", model: "m", createdBy: "t", createdById: null });
}

beforeEach(() => getWorkspace.mockClear());

describe("listTeamPhrases", () => {
  it("suggests the org's repeated Generate instructions, reading only", async () => {
    const { org } = await asMember("viewer");
    await save(org.id, "lifestyle", { category: "furniture", instructions: "soft morning window light, oak floor boards" });
    await save(org.id, "lifestyle", { category: "furniture", instructions: "oak floor boards, linen curtains" });
    expect(await listTeamPhrases({ tool: "generate", category: "furniture" })).toEqual(["oak floor boards"]);
    expect(getWorkspace).toHaveBeenCalledWith({ read: true });
  });

  it("Recolor reads notes from recolor results only; an approved result counts on its own", async () => {
    const { org } = await asMember();
    await save(org.id, "recolor", { category: "furniture", notes: "keep the wooden legs natural" });
    await save(org.id, "lifestyle", { category: "furniture", instructions: "brass lamp on the side" });
    expect(await listTeamPhrases({ tool: "recolor", category: "furniture" })).toEqual([]);
    await db.forOrg(org.id).update(schema.generations, { reviewStatus: "approved" }, undefined);
    expect(await listTeamPhrases({ tool: "recolor", category: "furniture" })).toEqual(["keep the wooden legs natural"]);
  });

  it("never shows another org's phrases", async () => {
    const other = await makeOrg();
    await save(other.org.id, "lifestyle", { category: "furniture", instructions: "secret rival backdrop" });
    await save(other.org.id, "lifestyle", { category: "furniture", instructions: "secret rival backdrop, soft shadow" });
    await asMember();
    expect(await listTeamPhrases({ tool: "generate", category: "furniture" })).toEqual([]);
  });

  it("returns nothing for an unknown tool, and works before a category is chosen", async () => {
    const { org } = await asMember();
    await save(org.id, "lifestyle", { category: "furniture", instructions: "white studio sweep" });
    await save(org.id, "lifestyle", { category: "decor", instructions: "white studio sweep, soft shadow" });
    expect(await listTeamPhrases({ tool: "copy" as never, category: "furniture" })).toEqual([]);
    expect(await listTeamPhrases({ tool: "generate", category: "" })).toEqual(["white studio sweep"]);
  });
});
