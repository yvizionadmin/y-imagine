import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { categoryPresets, findCategory, findSubcategory } from "@/lib/catalog-presets";
import { db, schema } from "@/lib/db";
import { customTypeId, PRODUCT_TYPES_PER_CATEGORY, type OrgCatalog, type OrgProductType } from "@/lib/product-types";

// Per-org catalog setup (Settings → Product Types): the categories an org doesn't sell are hidden
// in its pickers, and it can add its own product types inside a category.

const { organizations, productTypes } = schema;

export async function getOrgCatalog(orgId: string): Promise<OrgCatalog> {
  const [[org], types] = await Promise.all([
    db.select({ hidden: organizations.hiddenCategories }).from(organizations).where(eq(organizations.id, orgId)),
    db.forOrg(orgId).select(productTypes, undefined, { orderBy: [asc(productTypes.createdAt)] }),
  ]);
  return {
    hiddenCategories: (org?.hidden ?? []).filter((key) => findCategory(key)),
    productTypes: types.map(({ id, category, name }) => ({ id, category, name })),
  };
}

/** Hides or shows a category in the org's pickers. At least one category always stays visible. */
export async function setCategoryHidden(orgId: string, category: string, hidden: boolean): Promise<boolean> {
  if (!findCategory(category)) return false;
  const { hiddenCategories } = await getOrgCatalog(orgId);
  const next = hidden ? [...new Set([...hiddenCategories, category])] : hiddenCategories.filter((key) => key !== category);
  if (next.length >= categoryPresets.length) return false;
  await db.update(organizations).set({ hiddenCategories: next, updatedAt: new Date().toISOString() }).where(eq(organizations.id, orgId));
  return true;
}

export type AddTypeError = "invalid_input" | "duplicate" | "limit";

/** Adds an own product type; names are unique within a category (ignoring case), built-in ones included. */
export async function addProductType(orgId: string, input: { category: string; name: string; createdBy: string }, builtInNames: (key: string) => string[]): Promise<{ ok: true; type: OrgProductType } | { ok: false; error: AddTypeError }> {
  const category = findCategory(input.category);
  if (!category) return { ok: false, error: "invalid_input" };
  const existing = await db.forOrg(orgId).select(productTypes, eq(productTypes.category, category.key));
  if (existing.length >= PRODUCT_TYPES_PER_CATEGORY) return { ok: false, error: "limit" };
  const lower = input.name.toLowerCase();
  if (existing.some((t) => t.name.toLowerCase() === lower) || category.subcategories.some((key) => builtInNames(key).some((n) => n.toLowerCase() === lower))) {
    return { ok: false, error: "duplicate" };
  }
  const [row] = await db.forOrg(orgId).insert(productTypes, { id: randomUUID(), category: category.key, name: input.name, createdBy: input.createdBy });
  return { ok: true, type: { id: row.id, category: row.category, name: row.name } };
}

export async function removeProductType(orgId: string, id: string): Promise<OrgProductType | null> {
  const [row] = await db.forOrg(orgId).delete(productTypes, eq(productTypes.id, id));
  return row ? { id: row.id, category: row.category, name: row.name } : null;
}

/**
 * A product type sent by a tool, checked against the category: a built-in key stays as it is, one of
 * the org's own (`custom:<id>`) becomes its name (what the model and History get). Null for none;
 * undefined when it isn't a type of this category for this org.
 */
export async function resolveProductType(orgId: string, category: string, value: string | null | undefined): Promise<string | null | undefined> {
  if (!value) return null;
  const id = customTypeId(value);
  if (!id) return findSubcategory(category, value) ?? undefined;
  const own = await db.forOrg(orgId).first(productTypes, and(eq(productTypes.id, id), eq(productTypes.category, category)));
  return own?.name ?? undefined;
}
