"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { categoryPresets, findCategory, type CategoryPreset } from "@/lib/catalog-presets";
import { customTypeId, customTypeValue, EMPTY_ORG_CATALOG, type OrgCatalog } from "@/lib/product-types";

// The org's catalog setup (Settings → Product Types) for every picker: hidden categories and its own
// product types. The app layout loads it on the server (OrgCatalogInit) and Settings → Product Types
// pushes changes in; until it arrives the built-in lists show. No request of its own on each page.

type Store = { catalog: OrgCatalog; setCatalog: (catalog: OrgCatalog) => void };
const OrgCatalogContext = createContext<Store>({ catalog: EMPTY_ORG_CATALOG, setCatalog: () => {} });

export function OrgCatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<OrgCatalog>(EMPTY_ORG_CATALOG);
  const value = useMemo(() => ({ catalog, setCatalog }), [catalog]);
  return <OrgCatalogContext.Provider value={value}>{children}</OrgCatalogContext.Provider>;
}

/** Hands the server-loaded setup to the provider (rendered by the app layout). */
export function OrgCatalogInit({ catalog }: { catalog: OrgCatalog }) {
  const { setCatalog } = useContext(OrgCatalogContext);
  useEffect(() => setCatalog(catalog), [catalog, setCatalog]);
  return null;
}

export type ProductTypeOption = { value: string; label: string };

export function useOrgCatalog() {
  const { catalog, setCatalog } = useContext(OrgCatalogContext);
  const tp = useTranslations("Presets");
  return useMemo(() => {
    const hidden = new Set(catalog.hiddenCategories);
    return {
      catalog,
      setCatalog,
      /** The categories the org sells; `current` stays listed even when hidden, so a picked one never vanishes. */
      categories: (current?: string | null): CategoryPreset[] => categoryPresets.filter((c) => !hidden.has(c.key) || c.key === current),
      /** Built-in product types of a category, then the org's own. */
      typesFor: (category: string): ProductTypeOption[] => [
        ...(findCategory(category)?.subcategories ?? []).map((key) => ({ value: key, label: tp(`subcategories.${key}`) })),
        ...catalog.productTypes.filter((t) => t.category === category).map((t) => ({ value: customTypeValue(t.id), label: t.name })),
      ],
      /** What History stores for a product type: a built-in key as it is, one of the org's own by name. */
      storedType: (category: string, value: string | null): string | null => {
        if (!value || !customTypeId(value)) return value;
        return catalog.productTypes.find((t) => t.id === customTypeId(value) && t.category === category)?.name ?? null;
      },
      /** The name of a product type value (built-in key or own type), else null. */
      typeLabel: (category: string, value: string | null): string | null => {
        if (!value) return null;
        const id = customTypeId(value);
        if (id) return catalog.productTypes.find((t) => t.id === id && t.category === category)?.name ?? null;
        return findCategory(category)?.subcategories.includes(value) ? tp(`subcategories.${value}`) : null;
      },
    };
  }, [catalog, setCatalog, tp]);
}
