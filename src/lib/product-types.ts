// Product types an org adds inside a category, next to the built-in ones (Presets.subcategories).
// Client-safe: the value format shared by the pickers and the server.

export type OrgProductType = { id: string; category: string; name: string };

/** The org's view of the catalog presets: categories it hides, and its own product types. */
export type OrgCatalog = { hiddenCategories: string[]; productTypes: OrgProductType[] };

export const EMPTY_ORG_CATALOG: OrgCatalog = { hiddenCategories: [], productTypes: [] };

export const PRODUCT_TYPE_NAME_MAX = 60;
/** Own product types per category. */
export const PRODUCT_TYPES_PER_CATEGORY = 30;

const PREFIX = "custom:";

/** A picker value for one of the org's own types (built-in types use their preset key). */
export const customTypeValue = (id: string) => `${PREFIX}${id}`;
/** The id inside a custom type value, else null. */
export const customTypeId = (value: string | null | undefined) => (value?.startsWith(PREFIX) ? value.slice(PREFIX.length) || null : null);

/** A product type name as typed: one line, single spaces, null when empty or too long. */
export function cleanTypeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= PRODUCT_TYPE_NAME_MAX ? name : null;
}
