import { describe, expect, it, vi } from "vitest";
import { insertGeneration } from "@/lib/generations";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// B6: History filters by the product category a result was made for.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { queryHistory } = await import("@/features/history/actions");

describe("History category filter", () => {
  it("shows only results made for the chosen category", async () => {
    const made = await makeOrg();
    workspace = { orgId: made.org.id, orgName: made.org.name, role: "viewer", plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
    const save = (sku: string, category: string | null) =>
      insertGeneration({ orgId: made.org.id, mode: "lifestyle", sku, title: "T", assetId: "a", mimeType: "image/png", width: 1, height: 1, settings: { category }, provider: "demo", model: "m", createdBy: "t", createdById: null });
    await save("SOFA-1", "furniture");
    await save("LAMP-1", "lighting");
    await save("OLD-1", null);

    const base = { sort: "newest" as const, page: 1, pageSize: 24 };
    expect((await queryHistory({ ...base, category: "furniture" })).items.map((i) => i.sku)).toEqual(["SOFA-1"]);
    expect((await queryHistory(base)).items.map((i) => i.sku).sort()).toEqual(["LAMP-1", "OLD-1", "SOFA-1"]);
  });
});
