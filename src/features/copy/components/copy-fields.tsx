"use client";

import { ChevronDown, Layers, Package } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { DockToolbar, Field, MODE_SWITCH, modeSwitchItem } from "@/components/app/config-panel";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "@/i18n/navigation";
import { COPY_CHANNELS, COPY_LANGUAGES, COPY_LENGTHS, COPY_TONES, type CopyChannel, type CopyLanguage, type CopyLength, type CopyTone } from "@/lib/ai/types";
import { useOrgCatalog } from "@/components/app/org-catalog";

// Panel fields shared by single-product and bulk Copy.

export type CopyStyle = { tone: CopyTone; length: CopyLength; channel: CopyChannel; languages: CopyLanguage[]; brandVoice: boolean };

/** The org's brand kit for the toggle: undefined while loading, null when there is none. */
export type BrandSummary = { name: string } | null | undefined;

export const select =
  "w-full appearance-none rounded-lg border bg-transparent py-2 ps-3 pe-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Single product / Bulk switch at the top of the panel. */
export function CopyModeTabs({ mode }: { mode: "single" | "bulk" }) {
  const t = useTranslations("Copy");
  return (
    <DockToolbar>
      <nav aria-label={t("modeLabel")} className={MODE_SWITCH}>
        {(["single", "bulk"] as const).map((m) => (
          <Link
            key={m}
            href={m === "single" ? "/copy" : "/copy/bulk"}
            aria-current={m === mode ? "page" : undefined}
            className={modeSwitchItem(m === mode)}
          >
            {m === "single" ? <Package className="size-4" aria-hidden /> : <Layers className="size-4" aria-hidden />}
            {t(`modes.${m}`)}
          </Link>
        ))}
      </nav>
    </DockToolbar>
  );
}

export function CategorySelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const tp = useTranslations("Presets");
  const { categories: orgCategories } = useOrgCatalog();
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={select}>
          {orgCategories(value).map((c) => (
            <option key={c.key} value={c.key}>
              {tp(`categories.${c.key}`)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
      </div>
    </Field>
  );
}

/** Brand kit toggle, tone, length, channel and languages. */
export function CopyStyleFields({
  value,
  onChange,
  idPrefix,
  brand,
}: {
  value: CopyStyle;
  onChange: (patch: Partial<CopyStyle>) => void;
  idPrefix: string;
  brand: BrandSummary;
}) {
  const t = useTranslations("Copy");
  return (
    <>
      {brand ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <label htmlFor={`${idPrefix}-brand`} className="flex items-start gap-2.5 text-[13px]">
            <Checkbox id={`${idPrefix}-brand`} checked={value.brandVoice} onCheckedChange={(brandVoice) => onChange({ brandVoice })} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{t("brandVoice")}</span>
              <span className="text-xs text-muted-foreground">{brand.name ? t("brandVoiceHint", { name: brand.name }) : t("brandVoiceHintUnnamed")}</span>
            </span>
          </label>
          <Link href="/settings/brand" className="shrink-0 text-xs font-semibold text-primary hover:underline">
            {t("brandEdit")}
          </Link>
        </div>
      ) : brand === null ? (
        <p className="text-xs text-muted-foreground">
          {t.rich("brandMissing", { link: (chunks) => <Link href="/settings/brand" className="font-semibold text-primary hover:underline">{chunks}</Link> })}
        </p>
      ) : null}
      <Field label={t("tone")} gap="gap-1.5">
        <Chips options={COPY_TONES} value={value.tone} onChange={(tone) => onChange({ tone })} label={t("tone")} render={(v) => t(`tones.${v}`)} />
      </Field>
      <Field label={t("length")} gap="gap-1.5">
        <Chips options={COPY_LENGTHS} value={value.length} onChange={(length) => onChange({ length })} label={t("length")} render={(v) => t(`lengths.${v}`)} />
      </Field>
      <Field label={t("channel")} htmlFor={`${idPrefix}-channel`}>
        <div className="relative">
          <select id={`${idPrefix}-channel`} value={value.channel} onChange={(e) => onChange({ channel: e.target.value as CopyChannel })} className={select}>
            {COPY_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
        </div>
      </Field>
      <Field label={t("languagesLabel")} gap="gap-1.5">
        <div className="flex gap-1.5" role="group" aria-label={t("languagesLabel")}>
          {COPY_LANGUAGES.map((language) => {
            const on = value.languages.includes(language);
            return (
              <button
                key={language}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ languages: on ? value.languages.filter((l) => l !== language) : COPY_LANGUAGES.filter((l) => l === language || value.languages.includes(l)) })}
                className={cn("rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground", on && "border-primary bg-primary text-primary-foreground")}
              >
                {t(`languages.${language}`)}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function Chips<T extends string>({ options, value, onChange, label, render }: { options: readonly T[]; value: T; onChange: (value: T) => void; label: string; render: (value: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn("rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground", value === option && "border-primary bg-primary text-primary-foreground")}
        >
          {render(option)}
        </button>
      ))}
    </div>
  );
}
