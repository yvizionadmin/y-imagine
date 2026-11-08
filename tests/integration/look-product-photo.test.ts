import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertConnection } from "@/lib/catalog/connections";
import { db, schema } from "@/lib/db";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Adding a product to a Look: a photo whose cut-out would lose the product is refused right there,
// before it is stored and before any credit is spent. Demo catalog: the sofa is on a plain background;
// the oak chair's first photo is a pale chair against a pale wall, its second a studio shot.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { addLookProduct } = await import("@/features/looks/actions");

async function signedIn() {
  const made = await makeOrg();
  await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "editor", plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

const stored = (orgId: string) => db.forOrg(orgId).select(schema.assets);

beforeEach(() => vi.stubEnv("IMAGINE_DEMO", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("adding a product photo to a Look", () => {
  it("stores a product that cuts out cleanly", async () => {
    const { org } = await signedIn();
    const result = await addLookProduct({ source: "catalog", sku: "SOFA-12345", imageUrl: "/demo/sofa-grey-base.png" });
    expect(result.ok).toBe(true);
    expect(await stored(org.id)).toHaveLength(1);
  });

  it("refuses a photo that would lose the product, and stores nothing", async () => {
    const { org } = await signedIn();
    expect(await addLookProduct({ source: "catalog", sku: "CHAIR-OAK-99", imageUrl: "/demo/source-chair.png" })).toEqual({ ok: false, error: "unusable_photo" });
    expect(await stored(org.id)).toHaveLength(0);
  });

  it("lets the same product through with another of its photos", async () => {
    await signedIn();
    expect((await addLookProduct({ source: "catalog", sku: "CHAIR-OAK-99", imageUrl: "/demo/sofa-source.png" })).ok).toBe(true);
  });
});
