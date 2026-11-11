"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOrgCatalog } from "@/components/app/org-catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { categoryPresets, type CategoryPreset } from "@/lib/catalog-presets";
import { PRODUCT_TYPE_NAME_MAX, PRODUCT_TYPES_PER_CATEGORY, type OrgProductType } from "@/lib/product-types";
import { addProductType, getProductTypes, removeProductType, setCategoryVisible } from "../actions";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type State = Awaited<ReturnType<typeof getProductTypes>>;
type Notice = { category: string; kind: "duplicate" | "limit" | "error" | "lastCategory" } | null;

/**
 * Settings → Product Types (no Figma frame; the settings card layout): which product categories the
 * org sells, and its own product types inside each, next to the built-in ones. Admins change it;
 * everyone else reads it. The tools' pickers follow it (useOrgCatalog).
 */
export function ProductTypesSettings() {
  const t = useTranslations("ProductTypes");
  const { setCatalog } = useOrgCatalog();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // The pickers on other pages follow every change without a reload.
  const load = useCallback(
    () =>
      getProductTypes().then((next) => {
        setState(next);
        setCatalog({ hiddenCategories: next.hiddenCategories, productTypes: next.productTypes });
      }),
    [setCatalog],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, category: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setNotice(null);
    const result = await action().catch(() => ({ ok: false, error: "error" }));
    setBusy(null);
    if (!result.ok) {
      const kind = result.error === "duplicate" || result.error === "limit" ? result.error : key.startsWith("show:") ? "lastCategory" : "error";
      setNotice({ category, kind });
      return false;
    }
    await load();
    return true;
  }

  const canManage = state?.canManage ?? false;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="max-w-2xl text-[13px] text-muted-foreground">{t("description")}</p>
      </div>

      {state && !canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}

      {!state ? (
        <LoadingSkeleton variant="list" className="p-4" />
      ) : (
        <ul className="flex flex-col gap-3">
          {categoryPresets.map((category) => (
            <CategoryRow
              key={category.key}
              category={category}
              sold={!state.hiddenCategories.includes(category.key)}
              own={state.productTypes.filter((type) => type.category === category.key)}
              canManage={canManage}
              busy={busy}
              notice={notice?.category === category.key ? notice.kind : null}
              onSold={(sold) => run(`show:${category.key}`, category.key, () => setCategoryVisible(category.key, sold))}
              onAdd={(name) => run(`add:${category.key}`, category.key, () => addProductType(category.key, name))}
              onRemove={(type) => run(`remove:${type.id}`, category.key, () => removeProductType(type.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  sold,
  own,
  canManage,
  busy,
  notice,
  onSold,
  onAdd,
  onRemove,
}: {
  category: CategoryPreset;
  sold: boolean;
  own: OrgProductType[];
  canManage: boolean;
  busy: string | null;
  notice: NonNullable<Notice>["kind"] | null;
  onSold: (sold: boolean) => Promise<boolean>;
  onAdd: (name: string) => Promise<boolean>;
  onRemove: (type: OrgProductType) => Promise<boolean>;
}) {
  const t = useTranslations("ProductTypes");
  const tp = useTranslations("Presets");
  const [name, setName] = useState("");
  const label = tp(`categories.${category.key}`);
  const adding = busy === `add:${category.key}`;
  const full = own.length >= PRODUCT_TYPES_PER_CATEGORY;

  async function add() {
    const clean = name.trim();
    if (!clean || adding) return;
    if (await onAdd(clean)) setName("");
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-background p-4">
      <label className="flex items-center gap-2.5">
        <Checkbox checked={sold} disabled={!canManage || busy === `show:${category.key}`} onCheckedChange={(checked) => onSold(checked === true)} />
        <span className="text-[15px] font-bold">{label}</span>
        {!sold && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("hidden")}</span>}
      </label>

      <div className="flex flex-wrap gap-1.5" aria-label={t("typesOf", { category: label })} role="list">
        {category.subcategories.map((key) => (
          <span key={key} role="listitem" className="rounded-full border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            {tp(`subcategories.${key}`)}
          </span>
        ))}
        {own.map((type) => (
          <span key={type.id} role="listitem" dir="auto" className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 py-1 ps-2.5 pe-1 text-[11px] font-medium text-foreground">
            {type.name}
            {canManage && (
              <button
                type="button"
                aria-label={t("remove", { name: type.name })}
                disabled={busy === `remove:${type.id}`}
                onClick={() => onRemove(type)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("addLabel", { category: label })}
            placeholder={t("addPlaceholder")}
            value={name}
            maxLength={PRODUCT_TYPE_NAME_MAX}
            disabled={full}
            dir="auto"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void add();
            }}
            className="h-8 max-w-xs text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={!name.trim() || adding || full} onClick={() => void add()}>
            {adding ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
            {t("add")}
          </Button>
          {full && <span className="text-[11px] text-muted-foreground">{t("limit", { max: PRODUCT_TYPES_PER_CATEGORY })}</span>}
        </div>
      )}

      {notice && (
        <p role="alert" className="text-xs text-danger">
          {notice === "limit" ? t("limit", { max: PRODUCT_TYPES_PER_CATEGORY }) : t(`errors.${notice}`)}
        </p>
      )}
    </li>
  );
}
