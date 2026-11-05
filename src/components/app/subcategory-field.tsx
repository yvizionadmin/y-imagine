"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field } from "@/components/app/config-panel";
import { findCategory } from "@/lib/catalog-presets";

/** Optional product type inside the category (Sofas, Beds…), so the prompt names the exact product. */
export function SubcategoryField({
  id,
  category,
  value,
  onChange,
}: {
  id: string;
  category: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const tp = useTranslations("Presets");
  const subcategories = findCategory(category)?.subcategories ?? [];
  if (subcategories.length === 0) return null;
  return (
    <Field label={tp("subcategoryLabel")} htmlFor={id}>
      <div className="relative">
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full appearance-none rounded-lg border bg-transparent py-2 ps-3 pe-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">{tp("subcategoryAny", { category: tp(`categories.${category}`) })}</option>
          {subcategories.map((s) => (
            <option key={s} value={s}>
              {tp(`subcategories.${s}`)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
      </div>
    </Field>
  );
}
