import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace";
import { makeOrg, uniqueEmail } from "../helpers";

// Server actions with the signed-in user mocked (getWorkspace / getSession read the request in Next).

let workspace: Workspace;
let sessionUser: { id: string; name: string; email: string; platformRole: "super_admin" | null } | null = null;

vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getSession: async () => (sessionUser ? { user: sessionUser, orgId: null } : null),
}));

const { inviteMember, changeMemberRole, removeTeamMember } = await import("@/features/team/actions");
const { updateAdminOrg } = await import("@/features/admin/actions");
const { listMembers } = await import("@/lib/team/members");
const { updateOrganization } = await import("@/lib/platform/organizations");
const { generateLifestyleImage } = await import("@/features/generate/actions");
const { recolorProduct } = await import("@/features/recolor/actions");

async function asAdminOf(plan: "free" | "pro" = "free") {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "admin", plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 50, creditsRemaining: 50 };
  return made;
}

beforeEach(() => {
  sessionUser = null;
});

describe("team actions", () => {
  it("enforces the plan's seats, counting pending invitations", async () => {
    await asAdminOf("free"); // 3 seats, the admin uses one
    expect(await inviteMember({ email: uniqueEmail(), role: "editor", department: "" })).toEqual({ ok: true });
    expect(await inviteMember({ email: uniqueEmail(), role: "viewer", department: "" })).toEqual({ ok: true });
    expect(await inviteMember({ email: uniqueEmail(), role: "viewer", department: "" })).toEqual({ ok: false, error: "seat_limit" });
  });

  it("only admins manage the team", async () => {
    await asAdminOf();
    workspace = { ...workspace, role: "editor" };
    expect(await inviteMember({ email: uniqueEmail(), role: "editor", department: "" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("keeps at least one admin and blocks changing yourself", async () => {
    const { org } = await asAdminOf("pro");
    await inviteMember({ email: uniqueEmail(), role: "admin", department: "" });
    const members = await listMembers({ orgId: org.id });
    const me = members.find((m) => m.userId === workspace.user.id)!;
    const invited = members.find((m) => m.status === "invited")!;
    expect(await changeMemberRole(me.id, "viewer")).toEqual({ ok: false, error: "self" });
    // The pending admin invitation doesn't count as an active admin.
    expect(await removeTeamMember(invited.id)).toEqual({ ok: true });
  });
});

describe("super-admin console", () => {
  it("refuses everyone without the platform role", async () => {
    const { org } = await asAdminOf();
    sessionUser = { ...workspace.user, platformRole: null };
    expect(await updateAdminOrg(org.id, { name: "X", plan: "pro", creditsOverride: null })).toEqual({ ok: false, error: "forbidden" });
  });

  it("won't change the plan of an org paying through Stripe, but credits still change", async () => {
    const { org, user } = await asAdminOf("pro");
    sessionUser = { id: user.id, name: user.name, email: user.email, platformRole: "super_admin" };
    await updateOrganization(org.id, { stripeSubscriptionId: `sub_${org.id}`, billingStatus: "active" });
    expect(await updateAdminOrg(org.id, { name: org.name, plan: "starter", creditsOverride: null })).toEqual({ ok: false, error: "billing_managed" });
    expect(await updateAdminOrg(org.id, { name: org.name, plan: "pro", creditsOverride: 999 })).toEqual({ ok: true });
  });
});

describe("image tool inputs", () => {
  const pngFile = async (name: string) =>
    new File([new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#8899aa" } }).png().toBuffer())], name, { type: "image/png" });

  async function generateForm(fields: Record<string, string>) {
    const data = new FormData();
    data.set("sku", "SOFA-1");
    data.set("product", await pngFile("sofa.png"));
    data.set("category", "furniture");
    data.set("aspectRatio", "1:1");
    data.set("resolution", "HD");
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  }

  it("Generate accepts any library scene, one scene source, and a short product size", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await asAdminOf();
    // A bathroom scene isn't a furniture recommendation, but it's in the library.
    expect((await generateLifestyleImage(await generateForm({ scene: "spaBathroom", productSize: "220 × 95 × 85 cm" }))).ok).toBe(true);
    expect(await generateLifestyleImage(await generateForm({ scene: "notAScene" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateLifestyleImage(await generateForm({ scene: "spaBathroom", customScene: "a beach" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateLifestyleImage(await generateForm({ customScene: "x".repeat(501) }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateLifestyleImage(await generateForm({ productSize: "x".repeat(81) }))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("Generate accepts a known camera angle and an image of the first shot", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await asAdminOf();
    expect((await generateLifestyleImage(await generateForm({ angle: "frontLeft45", minimalProps: "1" }))).ok).toBe(true);
    expect(await generateLifestyleImage(await generateForm({ angle: "sideways" }))).toEqual({ ok: false, error: "invalid_input" });
    const matched = await generateForm({ angle: "left90" });
    matched.set("matchShot", await pngFile("first.png"));
    expect((await generateLifestyleImage(matched)).ok).toBe(true);
    matched.set("matchShot", new File(["<svg/>"], "first.svg", { type: "image/svg+xml" }));
    expect(await generateLifestyleImage(matched)).toEqual({ ok: false, error: "invalid_input" });
    vi.unstubAllEnvs();
  });

  it("Generate accepts a product type only from the chosen category", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await asAdminOf();
    expect((await generateLifestyleImage(await generateForm({ subcategory: "sofas" }))).ok).toBe(true);
    // Faucets are a bathroom type, not furniture.
    expect(await generateLifestyleImage(await generateForm({ subcategory: "faucets" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateLifestyleImage(await generateForm({ subcategory: "notAType" }))).toEqual({ ok: false, error: "invalid_input" });

    // The merchant's own background: one scene source only, images only.
    const withUpload = async (file: File, fields: Record<string, string> = {}) => {
      const data = await generateForm(fields);
      data.set("sceneImage", file);
      return generateLifestyleImage(data);
    };
    const upload = await withUpload(await pngFile("room.png"));
    expect(upload.ok && upload.image.url.startsWith("data:image/webp")).toBe(true);
    expect(await withUpload(await pngFile("room.png"), { scene: "livingRoom" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await withUpload(await pngFile("room.png"), { customScene: "a beach" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await withUpload(new File(["<svg/>"], "room.svg", { type: "image/svg+xml" }))).toEqual({ ok: false, error: "invalid_input" });
    vi.unstubAllEnvs();
  });

  it("Generate takes a PNG, JPG or WebP product, nothing else", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await asAdminOf();
    const withProduct = async (file: File) => {
      const data = await generateForm({});
      data.set("product", file);
      return generateLifestyleImage(data);
    };
    const jpg = new File([new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).jpeg().toBuffer())], "sofa.jpg", { type: "image/jpeg" });
    expect((await withProduct(jpg)).ok).toBe(true);
    const webp = new File([new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).webp().toBuffer())], "sofa.webp", { type: "image/webp" });
    expect((await withProduct(webp)).ok).toBe(true);
    expect(await withProduct(new File(["<svg/>"], "sofa.svg", { type: "image/svg+xml" }))).toEqual({ ok: false, error: "invalid_input" });
    vi.unstubAllEnvs();
  });

  it("Recolor only accepts a known scope", async () => {
    await asAdminOf();
    const data = new FormData();
    data.set("sku", "SOFA-1");
    data.set("category", "furniture");
    data.set("product", await pngFile("sofa.png"));
    data.set("swatch", await pngFile("swatch.png"));
    data.set("hex", "#D8C8B5");
    data.set("aspectRatio", "1:1");
    data.set("resolution", "HD");
    data.set("scope", "legsOnly");
    expect(await recolorProduct(data)).toEqual({ ok: false, error: "invalid_input" });
  });
});
