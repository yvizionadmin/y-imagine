"use server";

import { getTranslations } from "next-intl/server";
import { recordAudit } from "@/lib/audit";
import { addProductType as insertType, getOrgCatalog, removeProductType as deleteType, setCategoryHidden, type AddTypeError } from "@/lib/catalog/org-catalog";
import { cleanTypeName, type OrgCatalog, type OrgProductType } from "@/lib/product-types";
import { getWorkspace } from "@/lib/workspace";

// Settings → Product Types: which categories the org sells and its own product types. Everyone in
// the org reads it (the tools' pickers use it); only admins change it, and every change is audited.

/** The org's catalog setup. Reads only. */
export async function getProductTypes(): Promise<OrgCatalog & { canManage: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return { ...(await getOrgCatalog(workspace.orgId)), canManage: workspace.role === "admin" && !workspace.viewAs };
}

export async function setCategoryVisible(category: string, visible: boolean): Promise<{ ok: true } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  if (typeof category !== "string" || !(await setCategoryHidden(workspace.orgId, category, visible !== true))) return { ok: false, error: "invalid_input" };
  await recordAudit({ orgId: workspace.orgId, action: visible === true ? "catalog.category_shown" : "catalog.category_hidden", actor: workspace.user.name, target: category });
  return { ok: true };
}

export async function addProductType(category: string, name: string): Promise<{ ok: true; type: OrgProductType } | { ok: false; error: "forbidden" | AddTypeError }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const clean = cleanTypeName(name);
  if (!clean || typeof category !== "string") return { ok: false, error: "invalid_input" };
  // Built-in types are compared by their name in either language, so "Sofas" and "أرائك" are both taken.
  const [en, ar] = await Promise.all([getTranslations({ locale: "en", namespace: "Presets" }), getTranslations({ locale: "ar", namespace: "Presets" })]);
  const builtIn = (key: string) => [en(`subcategories.${key}`), ar(`subcategories.${key}`)];
  const result = await insertType(workspace.orgId, { category, name: clean, createdBy: workspace.user.name }, builtIn);
  if (result.ok) await recordAudit({ orgId: workspace.orgId, action: "catalog.type_added", actor: workspace.user.name, target: `${result.type.category}: ${result.type.name}` });
  return result;
}

export async function removeProductType(id: string): Promise<{ ok: true } | { ok: false; error: "forbidden" | "not_found" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const removed = typeof id === "string" ? await deleteType(workspace.orgId, id) : null;
  if (!removed) return { ok: false, error: "not_found" };
  await recordAudit({ orgId: workspace.orgId, action: "catalog.type_removed", actor: workspace.user.name, target: `${removed.category}: ${removed.name}` });
  return { ok: true };
}
