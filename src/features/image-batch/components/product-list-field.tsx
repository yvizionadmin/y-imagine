"use client";

import { useRef } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field, RequiredTag, Section } from "@/components/app/config-panel";
import { HiddenFileInput } from "@/components/app/upload-inputs";
import { Textarea } from "@/components/ui/textarea";
import { download } from "@/features/copy/components/copy-export";
import { Link } from "@/i18n/navigation";
import { IMAGE_BATCH_MAX_ROWS } from "@/lib/image-batch/rows";

export type ListSummary = { count: number; truncated: boolean; problems: { key: string; text: string }[] };

/** "Products" section of a bulk image panel: CSV upload or paste, template, and what will run. */
export function ProductListField({
  text,
  fileName,
  onText,
  onFile,
  summary,
  placeholder,
  hint,
  template,
}: {
  text: string;
  fileName: string | null;
  onText: (text: string) => void;
  onFile: (name: string, text: string) => void;
  summary: ListSummary;
  placeholder: string;
  hint: string;
  template: { name: string; csv: string };
}) {
  const t = useTranslations("ImageBulk");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(file: File | null) {
    if (file) onFile(file.name.replace(/\.[^.]+$/, "").slice(0, 120), await file.text());
  }

  return (
    <Section title={t("products")} aside={<RequiredTag />}>
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
        <FileSpreadsheet className="size-4 shrink-0 text-subtle" aria-hidden />
        <button type="button" onClick={() => fileRef.current?.click()} className="min-w-0 flex-1 truncate text-start text-xs text-subtle">
          {fileName ? <bdi className="text-foreground">{fileName}</bdi> : t("upload")}
        </button>
        <button type="button" onClick={() => download(template.name, template.csv, "text/csv;charset=utf-8")} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
          <Download className="size-3" aria-hidden />
          {t("template")}
        </button>
        <HiddenFileInput inputRef={fileRef} accept=".csv,.txt,text/csv,text/plain" onChange={load} />
      </div>
      <Field label={t("paste")} htmlFor="bulk-skus">
        <Textarea
          id="bulk-skus"
          dir="ltr"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="h-32 min-h-32 resize-none rounded-lg bg-muted p-3 font-mono text-[11px] leading-[1.5] wrap-anywhere placeholder:text-subtle md:text-[11px]"
        />
      </Field>
      {/* Column names (feature_1_text…) have no spaces: let them wrap anywhere so they can't widen the panel. */}
      <p className="text-[11px] leading-normal wrap-anywhere text-muted-foreground">{hint}</p>
      {text.trim() !== "" && (
        <div className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-[11px]" aria-live="polite">
          <span className="font-semibold">{t("summary", { count: summary.count })}</span>
          {summary.truncated && <span className="text-amber-600">{t("truncated", { max: IMAGE_BATCH_MAX_ROWS })}</span>}
          {summary.problems.length > 0 && (
            <>
              <span className="text-amber-600">{t("skipped", { count: summary.problems.length })}</span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {summary.problems.slice(0, 5).map((p) => (
                  <li key={p.key}>{p.text}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

/** The start error, with a link to Integrations when no catalog is connected. */
export function useStartError() {
  const t = useTranslations("ImageBulk");
  return (error: string, count: number, blockedTitle: string | null) =>
    blockedTitle
      ? { message: blockedTitle }
      : error === "not_enough_credits"
        ? { message: t("errors.notEnoughCredits", { count }) }
        : error === "no_connection"
          ? { message: t("errors.no_connection"), integrations: true }
          : error === "empty" || error === "forbidden" || error === "invalid_input"
            ? { message: t(`errors.${error}`) }
            : { message: t("errors.failed") };
}

export type StartError = { message: string; integrations?: boolean };

export function StartErrorBox({ error }: { error: StartError | null }) {
  const t = useTranslations("ImageBulk");
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-[#ef4444]">
      {error.message}{" "}
      {error.integrations && (
        <Link href="/settings/integrations" className="font-semibold underline">
          {t("connectCatalog")}
        </Link>
      )}
    </p>
  );
}
