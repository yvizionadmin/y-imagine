"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Download, FileText, Loader2, PenLine, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isBlocked, type BlockedReason } from "@/components/app/job-errors";
import type { CopyLanguage, ProductCopy } from "@/lib/ai/types";
import { LATN } from "@/lib/format";
import type { CopyView, ReviewRights } from "../actions";
import { copyAsCsv, copyAsText, download } from "./copy-export";
import { ReviewBadge, ReviewBar } from "./review-bar";

/** Recent copy list: everything, or only copy waiting for review. */
export type RecentFilter = "all" | "in_review";

export type CopyCanvasState =
  | { kind: "empty" }
  | { kind: "writing"; languages: CopyLanguage[] }
  | { kind: "result"; copy: CopyView }
  | { kind: "failed"; reason: "generation" | "input" | BlockedReason };

const SEO_LIMITS = { metaTitle: 60, metaDescription: 155 } as const;

/** Right side of the Copy tool: the written copy per language, editable in place, plus recent copy. */
export function CopyCanvas({
  state,
  recent,
  onOpen,
  onRegenerate,
  onEditSettings,
  onSave,
  rights,
  onReviewed,
  filter,
  onFilter,
}: {
  state: CopyCanvasState;
  recent: CopyView[];
  onOpen: (copy: CopyView) => void;
  onRegenerate: () => void;
  onEditSettings: () => void;
  onSave: (copy: CopyView["copy"]) => Promise<boolean>;
  rights: ReviewRights | null;
  onReviewed: (copy: CopyView) => void;
  filter: RecentFilter;
  onFilter: (filter: RecentFilter) => void;
}) {
  const t = useTranslations("Copy");
  const tw = useTranslations("Workspace");

  return (
    <section className="flex min-h-[16rem] min-w-0 shrink-0 grow flex-col gap-6 bg-canvas p-8">
      {state.kind === "empty" && (
        <div data-empty-state="" className="mx-auto flex w-[480px] max-w-full flex-col items-center gap-4 pt-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
            <PenLine className="size-8" strokeWidth={1.5} aria-hidden />
          </div>
          <h2 className="text-lg font-bold">{t("emptyTitle")}</h2>
          <p className="text-[13px] leading-normal text-muted-foreground">{t("emptyBody")}</p>
        </div>
      )}

      {state.kind === "writing" && (
        <div className={cn("grid gap-5", state.languages.length > 1 && "xl:grid-cols-2")} role="status" aria-live="polite">
          {state.languages.map((language) => (
            <div key={language} className="flex flex-col gap-4 rounded-2xl border bg-background p-6">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                {t("writing", { language: t(`languages.${language}`) })}
              </span>
              {[70, 100, 90, 95, 60].map((w, i) => (
                <span key={i} className="h-3 animate-pulse rounded-full bg-muted" style={{ width: `${w}%` }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {state.kind === "failed" && (
        <div className="mx-auto mt-16 flex w-[480px] max-w-full flex-col items-center gap-4 rounded-2xl border bg-background p-8 text-center" role="alert">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-danger">
            <TriangleAlert className="size-6" aria-hidden />
          </div>
          <h2 className="text-lg font-bold">{isBlocked(state.reason) ? tw(`blocked.${state.reason}.title`) : t("failedTitle")}</h2>
          <p className="text-[13px] leading-normal text-muted-foreground">
            {isBlocked(state.reason) ? tw(`blocked.${state.reason}.body`) : state.reason === "input" ? t("invalidInput") : t("failedBody")}
          </p>
          <div className="flex gap-3">
            {state.reason === "generation" && (
              <Button onClick={onRegenerate} className="h-9 px-4 text-[13px] font-semibold">
                <RefreshCw aria-hidden />
                {tw("tryAgain")}
              </Button>
            )}
            <Button variant="outline" onClick={onEditSettings} className="h-9 px-4 text-[13px] font-semibold">
              {tw("changeSettings")}
            </Button>
          </div>
        </div>
      )}

      {/* Keyed by copy: opening another one resets the editor; saving this one keeps it (and the "Saved" state). */}
      {state.kind === "result" && <CopyEditor key={state.copy.id} saved={state.copy} onRegenerate={onRegenerate} onSave={onSave} rights={rights} onReviewed={onReviewed} />}

      {(recent.length > 0 || filter !== "all") && (
        <RecentCopies recent={recent} activeId={state.kind === "result" ? state.copy.id : null} onOpen={onOpen} filter={filter} onFilter={onFilter} />
      )}
    </section>
  );
}

function CopyEditor({
  saved,
  onRegenerate,
  onSave,
  rights,
  onReviewed,
}: {
  saved: CopyView;
  onRegenerate: () => void;
  onSave: (copy: CopyView["copy"]) => Promise<boolean>;
  rights: ReviewRights | null;
  onReviewed: (copy: CopyView) => void;
}) {
  const t = useTranslations("Copy");
  const [draft, setDraft] = useState(saved.copy);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.copy);
  const languages = saved.settings.languages.filter((l) => draft[l]);

  const update = (language: CopyLanguage, patch: Partial<ProductCopy>) => {
    setSavedOk(false);
    setDraft((d) => ({ ...d, [language]: { ...d[language]!, ...patch } }));
  };

  async function save() {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    setSavedOk(ok);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[15px] font-bold">{saved.productName}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            <bdi>{saved.sku}</bdi> · <bdi>{saved.provider === "demo" ? t("demoModel") : saved.model}</bdi>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerate}>
            <RefreshCw aria-hidden />
            {t("regenerate")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => download(`${saved.sku}_copy.csv`, copyAsCsv({ sku: saved.sku, productName: saved.productName, copy: draft, review: saved.reviewStatus }), "text/csv;charset=utf-8")}>
            <Download aria-hidden />
            {t("exportCsv")}
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : savedOk && !dirty ? <Check aria-hidden /> : <Save aria-hidden />}
            {savedOk && !dirty ? t("saved") : t("saveEdits")}
          </Button>
        </div>
      </div>

      <ReviewBar copy={saved} rights={rights} dirty={dirty} onReviewed={onReviewed} />

      <div className={cn("grid items-start gap-5", languages.length > 1 && "xl:grid-cols-2")}>
        {languages.map((language) => (
          <LanguageColumn key={language} language={language} copy={draft[language]!} onChange={(patch) => update(language, patch)} />
        ))}
      </div>
    </div>
  );
}

function LanguageColumn({ language, copy, onChange }: { language: CopyLanguage; copy: ProductCopy; onChange: (patch: Partial<ProductCopy>) => void }) {
  const t = useTranslations("Copy");
  const dir = language === "ar" ? "rtl" : "ltr";
  const field = "rounded-lg bg-muted text-[13px] leading-relaxed md:text-[13px]";

  return (
    <article lang={language} dir={dir} className="flex flex-col gap-4 rounded-2xl border bg-background p-6" aria-label={t(`languages.${language}`)}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-primary uppercase">{t(`languages.${language}`)}</span>
        <CopyButton text={copyAsText(copy)} label={t("copyAll")} />
      </div>

      <Block label={t("fields.title")} copyText={copy.title}>
        <Textarea value={copy.title} onChange={(e) => onChange({ title: e.target.value })} rows={2} className={cn(field, "min-h-0 resize-none font-semibold")} />
      </Block>

      <Block label={t("fields.bullets")} copyText={copy.bullets.map((b) => `• ${b}`).join("\n")} hint={t("bulletsHint")}>
        <Textarea
          value={copy.bullets.join("\n")}
          onChange={(e) => onChange({ bullets: e.target.value.split("\n") })}
          onBlur={() => onChange({ bullets: copy.bullets.map((b) => b.trim()).filter(Boolean) })}
          rows={Math.max(4, copy.bullets.length + 1)}
          className={cn(field, "min-h-0")}
        />
      </Block>

      <Block label={t("fields.description")} copyText={copy.description}>
        <Textarea value={copy.description} onChange={(e) => onChange({ description: e.target.value })} rows={6} className={cn(field, "min-h-0")} />
      </Block>

      <div className="flex flex-col gap-4 rounded-xl border border-dashed p-4">
        <span className="text-[11px] font-bold text-muted-foreground uppercase">{t("seo")}</span>
        <Block label={t("fields.metaTitle")} copyText={copy.metaTitle} counter={{ value: copy.metaTitle.length, max: SEO_LIMITS.metaTitle }}>
          <Input value={copy.metaTitle} onChange={(e) => onChange({ metaTitle: e.target.value })} className={field} />
        </Block>
        <Block label={t("fields.metaDescription")} copyText={copy.metaDescription} counter={{ value: copy.metaDescription.length, max: SEO_LIMITS.metaDescription }}>
          <Textarea value={copy.metaDescription} onChange={(e) => onChange({ metaDescription: e.target.value })} rows={3} className={cn(field, "min-h-0 resize-none")} />
        </Block>
        <Block label={t("fields.tags")} copyText={copy.tags.join(", ")}>
          <TagsInput tags={copy.tags} onChange={(tags) => onChange({ tags })} />
        </Block>
      </div>
    </article>
  );
}

/**
 * Comma-separated tags, edited as text and split when the field loses focus. The editor remounts
 * per copy (keyed) and only this field changes the tags, so the initial value is enough.
 */
function TagsInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState(tags.join(", "));
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onChange(value.split(",").map((t) => t.trim()).filter(Boolean))}
      className="rounded-lg bg-muted text-[13px] md:text-[13px]"
    />
  );
}

function Block({ label, copyText, hint, counter, children }: { label: string; copyText: string; hint?: string; counter?: { value: number; max: number }; children: ReactNode }) {
  const t = useTranslations("Copy");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        <span className="flex items-center gap-2">
          {counter && (
            <span className={cn("font-mono text-[10px]", counter.value > counter.max ? "font-bold text-amber-600" : "text-subtle")} dir="ltr">
              {t("counter", { value: format.number(counter.value, LATN), max: format.number(counter.max, LATN) })}
            </span>
          )}
          <CopyButton text={copyText} label={t("copyField", { field: label })} iconOnly />
        </span>
      </div>
      {children}
      {hint && <span className="text-[10px] text-subtle">{hint}</span>}
    </div>
  );
}

function CopyButton({ text, label, iconOnly }: { text: string; label: string; iconOnly?: boolean }) {
  const t = useTranslations("Copy");
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  const Icon = copied ? Check : Copy;
  return iconOnly ? (
    <button type="button" onClick={copy} aria-label={label} title={label} className="text-muted-foreground hover:text-foreground">
      <Icon className="size-3.5" aria-hidden />
    </button>
  ) : (
    <Button type="button" variant="ghost" size="sm" onClick={copy} className="h-7 text-xs">
      <Icon aria-hidden />
      {copied ? t("copied") : label}
    </Button>
  );
}

function RecentCopies({
  recent,
  activeId,
  onOpen,
  filter,
  onFilter,
}: {
  recent: CopyView[];
  activeId: string | null;
  onOpen: (copy: CopyView) => void;
  filter: RecentFilter;
  onFilter: (filter: RecentFilter) => void;
}) {
  const t = useTranslations("Copy");
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase">{t("recent")}</h3>
        <div role="radiogroup" aria-label={t("review.filterLabel")} className="flex gap-1 rounded-lg bg-muted p-1">
          {(["all", "in_review"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => onFilter(f)}
              className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold text-muted-foreground", filter === f && "bg-background text-foreground shadow-sm")}
            >
              {t(`review.filter.${f}`)}
            </button>
          ))}
        </div>
      </div>
      {recent.length === 0 && <p className="text-xs text-muted-foreground">{t("review.nothingInReview")}</p>}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {recent.map((copy) => (
          <li key={copy.id}>
            <button
              type="button"
              onClick={() => onOpen(copy)}
              aria-current={copy.id === activeId ? "true" : undefined}
              className={cn("flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-start hover:border-primary", copy.id === activeId && "border-primary ring-1 ring-primary")}
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold">{copy.productName}</span>
                  <ReviewBadge status={copy.reviewStatus} />
                </span>
                {/* Each part isolated, so SKU, languages and date don't reorder each other in RTL. */}
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  <bdi>{copy.sku}</bdi> · <bdi>{copy.settings.languages.map((l) => l.toUpperCase()).join(" + ")}</bdi> ·{" "}
                  <bdi>{format.dateTime(new Date(copy.createdAt), { dateStyle: "medium", ...LATN })}</bdi>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
