import { describe, expect, it, vi } from "vitest";
import { describeImageModel } from "@/lib/ai/image-model-info";
import { setModelPreference } from "@/lib/ai/model-preferences";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import type { PlanId } from "@/lib/plans";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// The rail's AI Image menu: the image models the org's keys can call for the Studio, and which one
// Studio images run on.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { getImageModelMenu } = await import("@/features/ai-providers/actions");

async function signedIn(role: Workspace["role"] = "admin", plan: PlanId = "pro") {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

describe("AI Image menu", () => {
  it("lists nothing without an image key", async () => {
    const { org } = await signedIn();
    await saveProviderKey({ orgId: org.id, provider: "anthropic", key: "sk-ant-test-000000000000", models: ["claude-sonnet-5-5"], createdBy: "t" });
    expect(await getImageModelMenu()).toEqual({ models: [], canManage: true });
  });

  it("lists the keys' image models, Automatic's first pick in use, then the chosen model", async () => {
    const { org } = await signedIn("editor");
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1", "gpt-image-2", "gpt-5"], createdBy: "t" });
    await saveProviderKey({ orgId: org.id, provider: "gemini", key: "AIza-test-00000000000000", models: ["gemini-3-pro-image-preview"], createdBy: "t" });

    const menu = await getImageModelMenu();
    expect(menu.canManage).toBe(false);
    expect(menu.models.map((m) => [m.provider, m.model, m.name, m.inUse])).toEqual([
      ["openai", "gpt-image-2", "GPT Image 2", true],
      ["openai", "gpt-image-1", "GPT Image 1", false],
      ["gemini", "gemini-3-pro-image-preview", "Nano Banana Pro", false],
    ]);

    await setModelPreference(org.id, "create", { provider: "gemini", model: "gemini-3-pro-image-preview" }, "t");
    expect((await getImageModelMenu()).models.filter((m) => m.inUse).map((m) => m.model)).toEqual(["gemini-3-pro-image-preview"]);
  });

  it("names unknown model ids from the id", () => {
    expect(describeImageModel("openai", "gpt-image-3-mini")).toEqual({ provider: "openai", model: "gpt-image-3-mini", name: "GPT Image 3 Mini", blurb: null, inUse: false });
  });
});
