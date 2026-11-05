"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { categoryPresets, findSubcategory } from "@/lib/catalog-presets";

/** The preset key in `?category=`, or null when it is missing or unknown. */
export function useCategoryParam() {
  const value = useSearchParams().get("category");
  return categoryPresets.some((c) => c.key === value) ? value : null;
}

/**
 * Keeps a tool's category and the `?category=` in the address in step: a new param (another
 * template card, while the router keeps the screen mounted) calls `apply`, and `choose` applies a
 * picked category and writes it to the address so reloads and shared links open the same one.
 */
export function useCategorySync(current: string, apply: (category: string) => void) {
  const searchParams = useSearchParams();
  const param = useCategoryParam();
  const [synced, setSynced] = useState(param);
  // Adjusting state during render (not in an effect) avoids painting the stale category first.
  if (param !== synced) {
    setSynced(param);
    if (param && param !== current) apply(param);
  }
  return (category: string) => {
    apply(category);
    setSynced(category);
    const params = new URLSearchParams(searchParams.toString());
    params.set("category", category);
    // A product type (?sub=) belongs to the old category.
    params.delete("sub");
    window.history.replaceState(null, "", `?${params}`);
  };
}

/**
 * The product type (`?sub=`) of the current category, kept in step with the address like
 * useCategorySync: it follows a new param or category (a type never outlives its category), and
 * `choose` writes the pick back so reloads and shared links keep it.
 */
export function useSubcategorySync(category: string) {
  const searchParams = useSearchParams();
  const param = searchParams.get("sub");
  const [state, setState] = useState(() => ({ category, param, value: findSubcategory(category, param) }));
  if (state.category !== category || state.param !== param) {
    setState({ category, param, value: findSubcategory(category, param) });
  }
  const choose = (value: string | null) => {
    setState({ category, param: value, value });
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("sub", value);
    else params.delete("sub");
    window.history.replaceState(null, "", `?${params}`);
  };
  return [state.value, choose] as const;
}
