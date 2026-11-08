"use server";

import { listAudit, recordAudit, type AuditEntry } from "@/lib/audit";
import { cleanBrandKit, getBrandKit, setBrandKit, type SavedBrandKit } from "@/lib/brand/brand-kit";
import { getWorkspace } from "@/lib/workspace";

type Failure = { ok: false; error: "forbidden" | "invalid_input" };

export async function getBrandKitSettings(): Promise<{ kit: SavedBrandKit | null; canManage: boolean; activity: AuditEntry[] }> {
  const workspace = await getWorkspace({ read: true });
  const [kit, activity] = await Promise.all([getBrandKit(workspace.orgId), listAudit(workspace.orgId, { prefix: "brand_kit.", limit: 10 })]);
  return { kit, canManage: workspace.role === "admin", activity };
}

/** For the Copy panel: whether there is a kit to write with, and its name. */
export async function getBrandKitSummary(): Promise<{ name: string } | null> {
  const workspace = await getWorkspace({ read: true });
  const kit = await getBrandKit(workspace.orgId);
  return kit ? { name: kit.name } : null;
}

/** Admins only. An empty kit removes it. */
export async function saveBrandKit(input: unknown): Promise<{ ok: true; kit: SavedBrandKit | null } | Failure> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const kit = cleanBrandKit(input);
  if (kit === "invalid") return { ok: false, error: "invalid_input" };
  const existed = Boolean(await getBrandKit(workspace.orgId));
  await setBrandKit(workspace.orgId, kit, workspace.user.name);
  if (kit || existed) {
    await recordAudit({ orgId: workspace.orgId, action: kit ? "brand_kit.updated" : "brand_kit.removed", actor: workspace.user.name, target: kit?.name || "brand kit" });
  }
  return { ok: true, kit: await getBrandKit(workspace.orgId) };
}
