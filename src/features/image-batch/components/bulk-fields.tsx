"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Field } from "@/components/app/config-panel";
import { SubcategoryField } from "@/components/app/subcategory-field";
import { categoryPresets, findCategory } from "@/lib/catalog-presets";

// Panel fields the bulk image tools share with their single-product panels.

/** Category select plus the optional product type inside it. */
export function CategoryFields({
  label,
  category,
  subcategory,
  onCategory,
  onSubcategory,
}: {
  label: string;
  category: string;
  subcategory: string | null;
  onCategory: (key: string) => void;
  onSubcategory: (key: string | null) => void;
}) {
  const tp = useTranslations("Presets");
  return (
    <>
      <Field label={label} htmlFor="bulk-category">
        <div className="relative">
          <select
            id="bulk-category"
            value={category}
            onChange={(e) => onCategory(e.target.value)}
            className="w-full appearance-none rounded-lg border bg-transparent py-2 ps-3 pe-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {categoryPresets.map((c) => (
              <option key={c.key} value={c.key}>
                {tp(`categories.${c.key}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
        </div>
      </Field>
      <SubcategoryField id="bulk-subcategory" category={category} value={subcategory} onChange={onSubcategory} />
    </>
  );
}

/** The category's style chips (tap again to clear). */
export function StyleChips({ category, value, onChange }: { category: string; value: string | null; onChange: (style: string | null) => void }) {
  const tp = useTranslations("Presets");
  const preset = findCategory(category) ?? categoryPresets[0];
  const label = tp(`styleLabels.${preset.styleLabel}`);
  return (
    <Field label={label} gap="gap-1.5">
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {preset.styles.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            onClick={() => onChange(value === s ? null : s)}
            className={cn("rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground", value === s && "border-primary bg-primary text-primary-foreground")}
          >
            {tp(`styles.${s}`)}
          </button>
        ))}
      </div>
    </Field>
  );
}
