import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { encodeViewAs } from "@/lib/auth/view-as";
import { VIEW_AS_COOKIE } from "@/lib/auth/constants";
import { getWorkspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

const jar = new Map<string, string>();
let requestHeaders: Record<string, string> = {};
let signedIn: { id: string; name: string; email: string; platformRole: string; status: string };
let sessionOrg: string | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(requestHeaders),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ user: signedIn, orgId: sessionOrg }),
  signedOutPath: async () => "/sign-in",
  countActiveSessions: async () => 0,
  revokeUserSessions: async () => 0,
}));

const later = () => Date.now() + 60_000;

describe("viewing an org as its admin", () => {
  let customer: Awaited<ReturnType<typeof makeOrg>>;
  let staff: Awaited<ReturnType<typeof makeOrg>>;

  beforeEach(async () => {
    jar.clear();
    requestHeaders = {};
    customer = await makeOrg();
    staff = await makeOrg();
    sessionOrg = staff.org.id;
    signedIn = { ...staff.user, platformRole: "super_admin", status: "active" } as typeof signedIn;
  });

  const view = () => jar.set(VIEW_AS_COOKIE, encodeViewAs(signedIn.id, customer.org.id, later()));

  it("shows the viewed org as an admin, with no way to other orgs", async () => {
    view();
    const workspace = await getWorkspace();
    expect(workspace).toMatchObject({ orgId: customer.org.id, role: "admin", orgs: [{ id: customer.org.id }] });
    expect(workspace.viewAs).toBeDefined();
  });

  it("does nothing for someone who isn't a super admin, even with a real token", async () => {
    view();
    signedIn = { ...signedIn, platformRole: "user" };
    const workspace = await getWorkspace();
    expect(workspace.orgId).toBe(staff.org.id);
    expect(workspace.viewAs).toBeUndefined();
  });

  it("does nothing with a token issued to someone else, or an expired one", async () => {
    jar.set(VIEW_AS_COOKIE, encodeViewAs("another-admin", customer.org.id, later()));
    expect((await getWorkspace()).orgId).toBe(staff.org.id);
    jar.set(VIEW_AS_COOKIE, encodeViewAs(signedIn.id, customer.org.id, Date.now() - 1));
    expect((await getWorkspace()).orgId).toBe(staff.org.id);
  });

  it("does nothing if the org no longer exists", async () => {
    jar.set(VIEW_AS_COOKIE, encodeViewAs(signedIn.id, "00000000-0000-0000-0000-000000000000", later()));
    expect((await getWorkspace()).orgId).toBe(staff.org.id);
  });

  it("refuses Server Actions unless they are marked as reads, and sends them back to the page", async () => {
    view();
    requestHeaders = { "next-action": "abc", referer: "https://app.test/ar/settings/team?x=1" };
    await expect(getWorkspace()).rejects.toThrow("redirect:/ar/settings/team?readOnly=1");
    expect((await getWorkspace({ read: true })).orgId).toBe(customer.org.id);
  });

  it("never redirects a refusal to another site", async () => {
    view();
    requestHeaders = { "next-action": "abc", referer: "not a url" };
    await expect(getWorkspace()).rejects.toThrow("redirect:/home?readOnly=1");
  });

  it("leaves pages, and everyone outside a view, alone", async () => {
    view();
    expect((await getWorkspace()).orgId).toBe(customer.org.id);
    jar.clear();
    requestHeaders = { "next-action": "abc" };
    expect((await getWorkspace()).orgId).toBe(staff.org.id);
  });

  it("logs opening and closing the view on the customer's org", async () => {
    const { startViewAs, stopViewAs } = await import("@/features/admin/actions");
    await expect(startViewAs(customer.org.id)).rejects.toThrow("redirect:/en/home");
    expect(jar.has(VIEW_AS_COOKIE)).toBe(true);
    await expect(stopViewAs()).rejects.toThrow(`redirect:/en/admin/organizations/${customer.org.id}`);
    expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
    const actions = (await listAudit(customer.org.id, { prefix: "org.view", limit: 10 })).map((entry) => entry.action);
    expect(actions.sort()).toEqual(["org.view_ended", "org.view_started"]);
  });

  it("won't open a view for someone who isn't a super admin", async () => {
    const { startViewAs } = await import("@/features/admin/actions");
    signedIn = { ...signedIn, platformRole: "user" };
    expect(await startViewAs(customer.org.id)).toEqual({ ok: false, error: "forbidden" });
    expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
    expect(await listAudit(customer.org.id, { prefix: "org.view", limit: 10 })).toEqual([]);
  });
});
