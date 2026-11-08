"use client";

import { useRef, useState } from "react";
import { CircleCheck, ClipboardList, Download, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { DockToolbar, Section } from "@/components/app/config-panel";
import { HiddenFileInput } from "@/components/app/upload-inputs";
import { Textarea } from "@/components/ui/textarea";
import { download } from "@/features/copy/components/copy-export";
import { Link } from "@/i18n/navigation";
import { IMAGE_BATCH_MAX_ROWS } from "@/lib/image-batch/rows";

export type ListSummary = { count: number; truncated: boolean; problems: { key: string; text: string }[] };

/** "Products" in a bulk image tool's dock: paste SKUs or upload a CSV (one at a time), and what will run. */
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

  // One input at a time: paste a list, or upload a CSV (with its template).
  const [source, setSource] = useState<"paste" | "csv">(fileName ? "csv" : "paste");

  return (
    <Section title={t("products")} inline bare>
      <DockToolbar end>
        <SourceSwitch value={source} onChange={setSource} pasteLabel={t("sourcePaste")} />
      </DockToolbar>
      {source === "paste" ? (
        <>
          <label htmlFor="bulk-skus" className="sr-only">
            {t("paste")}
          </label>
          <Textarea
            id="bulk-skus"
            dir="ltr"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            className="field-sizing-content max-h-36 min-h-20 resize-none rounded-xl border-input bg-muted/40 px-3 py-2.5 font-mono text-[13px] leading-[1.5] wrap-anywhere placeholder:font-sans placeholder:text-muted-foreground hover:border-ring/50 focus-visible:bg-background md:text-[13px] dark:bg-input/30"
          />
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-3">
          <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <button type="button" onClick={() => fileRef.current?.click()} className="min-w-0 flex-1 truncate text-start text-sm text-muted-foreground hover:text-foreground">
            {fileName ? <bdi className="font-semibold text-foreground">{fileName}</bdi> : t("upload")}
          </button>
          <button type="button" onClick={() => download(template.name, template.csv, "text/csv;charset=utf-8")} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
            <Download className="size-3.5" aria-hidden />
            {t("template")}
          </button>
        </div>
      )}
      <HiddenFileInput inputRef={fileRef} accept=".csv,.txt,text/csv,text/plain" onChange={load} />
      {text.trim() === "" ? (
        // Column names (feature_1_text…) have no spaces: let them wrap anywhere so they can't widen the bar.
        <p className="text-xs leading-normal wrap-anywhere text-muted-foreground">{hint}</p>
      ) : (
        <div className="flex flex-col gap-1 text-xs" aria-live="polite">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn("flex items-center gap-1 font-semibold", summary.count > 0 ? "text-emerald-600" : "text-muted-foreground")}>
              {summary.count > 0 && <CircleCheck className="size-3.5" aria-hidden />}
              {t("summary", { count: summary.count })}
            </span>
            {summary.problems.length > 0 && <span className="font-semibold text-amber-600">{t("skipped", { count: summary.problems.length })}</span>}
            {summary.truncated && <span className="text-amber-600">{t("truncated", { max: IMAGE_BATCH_MAX_ROWS })}</span>}
          </span>
          {summary.problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {summary.problems.slice(0, 3).map((p) => (
                <li key={p.key}>{p.text}</li>
              ))}
            </ul>
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
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-danger">
      {error.message}{" "}
      {error.integrations && (
        <Link href="/settings/integrations" className="font-semibold underline">
          {t("connectCatalog")}
        </Link>
      )}
    </p>
  );
}

/** Paste a list or upload a CSV: the bulk tools show one of the two at a time. */
export function SourceSwitch({ value, onChange, pasteLabel }: { value: "paste" | "csv"; onChange: (value: "paste" | "csv") => void; pasteLabel: string }) {
  const t = useTranslations("ImageBulk");
  return (
    <div role="radiogroup" aria-label={t("sourceLabel")} className="flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {(["paste", "csv"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground", value === key && "bg-background text-foreground shadow-xs")}
        >
          {key === "paste" ? <ClipboardList className="size-3.5" aria-hidden /> : <FileSpreadsheet className="size-3.5" aria-hidden />}
          {key === "paste" ? pasteLabel : t("sourceCsv")}
        </button>
      ))}
    </div>
  );
}
