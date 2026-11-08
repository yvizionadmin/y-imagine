"use client";

import { useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { findCategory, subcategoryImage } from "@/lib/catalog-presets";
import { useCategoryParam } from "@/lib/use-category-param";
import { templateCategories, type TemplateCategory } from "../categories";

const card = "flex items-center gap-3 rounded-2xl border bg-background p-3 shadow-xs";
const linkCard = `${card} transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`;

const generateHref = (category: string, subcategory?: string) =>
  `/generate?category=${category}${subcategory ? `&sub=${subcategory}` : ""}`;

/**
 * The "+" picker (Figma 19:3): search plus the category grid. A card opens that category's product
 * types (`?category=`), and a type opens New Campaign (Generate) with it preselected, so the prompt
 * names the exact product. Search also matches product types across categories. Categories
 * without a preset yet are shown as coming soon.
 */
export function TemplateExplorer() {
  const t = useTranslations("Templates");
  const tp = useTranslations("Presets");
  const [query, setQuery] = useState("");
  const selected = useCategoryParam();

  const needle = query.trim().toLocaleLowerCase();
  const matches = (label: string) => !needle || label.toLocaleLowerCase().includes(needle);

  const selectedCategory = selected ? templateCategories.find((c) => c.key === selected) : undefined;
  const categories = templateCategories.filter((c) => matches(t(`categories.${c.key}`)));
  // While searching, product types match too ("sofa" finds Furniture › Sofas).
  const types = needle
    ? templateCategories.flatMap((c) =>
        (findCategory(c.key)?.subcategories ?? [])
          .filter((s) => matches(tp(`subcategories.${s}`)))
          .map((s) => ({ category: c, key: s })),
      )
    : [];

  return (
    <div className="flex flex-1 flex-col gap-10 overflow-y-auto bg-muted/40 p-6 md:p-12">
      <div className="flex justify-center">
        <label className="flex w-full max-w-[800px] items-center gap-4 rounded-3xl border bg-card px-6 py-[18px] shadow-[0_12px_16px_rgba(124,92,252,0.08)] focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="size-6 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">{t("searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground/60"
          />
        </label>
      </div>

      {selectedCategory ? (
        <CategoryView category={selectedCategory} matches={matches} query={query.trim()} />
      ) : (
        <section className="flex flex-col gap-6" aria-labelledby="templates-title">
          <h1 id="templates-title" className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          {categories.length === 0 && types.length === 0 && <NoResults query={query.trim()} />}
          {categories.length > 0 && (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {categories.map((c) => (
                <li key={c.key}>
                  <CategoryCard category={c} />
                </li>
              ))}
            </ul>
          )}
          {types.length > 0 && (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {types.map(({ category, key }) => (
                <li key={`${category.key}.${key}`}>
                  <SubcategoryCard
                    image={subcategoryImage(key)}
                    href={generateHref(category.key, key)}
                    label={tp(`subcategories.${key}`)}
                    hint={t("resultIn", { category: t(`categories.${category.key}`) })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function CategoryCard({ category }: { category: TemplateCategory }) {
  const t = useTranslations("Templates");
  const ready = findCategory(category.key) !== undefined;
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative; the card's text names the category */}
      <img src={category.image} alt="" width={96} height={96} className="size-24 shrink-0 rounded-xl object-cover" />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="text-[15px] font-semibold text-foreground">{t(`categories.${category.key}`)}</span>
        {!ready && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">{t("soon")}</span>
        )}
      </span>
    </>
  );
  return ready ? (
    <Link href={`/templates?category=${category.key}`} className={`${linkCard} h-[120px]`}>
      {body}
    </Link>
  ) : (
    <div aria-disabled className={`${card} h-[120px] cursor-default opacity-70`}>
      {body}
    </div>
  );
}

/** One category's product types, plus "All <category>" for products that fit none of them. */
function CategoryView({
  category,
  matches,
  query,
}: {
  category: TemplateCategory;
  matches: (label: string) => boolean;
  query: string;
}) {
  const t = useTranslations("Templates");
  const tp = useTranslations("Presets");
  const name = t(`categories.${category.key}`);
  const types = (findCategory(category.key)?.subcategories ?? []).filter((s) => matches(tp(`subcategories.${s}`)));
  const showAll = matches(name) || !query;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="templates-title">
      <div className="flex flex-col gap-2">
        <Link
          href="/templates"
          className="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("back")}
        </Link>
        <h1 id="templates-title" className="text-2xl font-bold tracking-tight text-foreground">
          {name}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subcategoriesTitle")}</p>
      </div>

      {!showAll && types.length === 0 ? (
        <NoResults query={query} />
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {showAll && (
            <li>
              <SubcategoryCard
                image={category.image}
                href={generateHref(category.key)}
                label={t("allOf", { category: name })}
                hint={t("allOfHint")}
              />
            </li>
          )}
          {types.map((s) => (
            <li key={s}>
              <SubcategoryCard image={subcategoryImage(s)} href={generateHref(category.key, s)} label={tp(`subcategories.${s}`)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubcategoryCard({ image, href, label, hint }: { image: string; href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className={`${linkCard} h-[120px]`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative; the card's text names the product type */}
      <img src={image} alt="" width={96} height={96} className="size-24 shrink-0 rounded-xl object-cover" />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="text-[15px] font-semibold text-foreground">{label}</span>
        {hint && <span className="text-xs text-white/60">{hint}</span>}
      </span>
    </Link>
  );
}

function NoResults({ query }: { query: string }) {
  const t = useTranslations("Templates");
  return (
    <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {t("noResults", { query })}
    </p>
  );
}
