"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { ConfigPanel, Field, PanelBody, PanelFooter, PanelHeader, RequiredTag, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { HiddenFileInput } from "@/components/app/upload-inputs";
import { categoryPresets } from "@/lib/catalog-presets";
import { BATCH_MAX_ROWS, BATCH_TEMPLATE_CSV, parseBatchInput } from "@/lib/copy/batch-csv";
import { getBrandKitSummary } from "@/features/brand/actions";
import { getCopyReviewRights, type ReviewRights } from "../actions";
import { getCopyBatch, listCopyBatches, startCopyBatch, type BatchFailure, type BatchItemView, type BatchView } from "../batch-actions";
import { BulkCanvas } from "./bulk-canvas";
import { CategorySelect, CopyModeTabs, CopyStyleFields, type BrandSummary, type CopyStyle } from "./copy-fields";
import { download } from "./copy-export";

const CATEGORY_KEYS = categoryPresets.map((c) => c.key);
const POLL_MS = 2500;

const initialStyle: CopyStyle = { tone: "professional", length: "medium", channel: "website", languages: ["en", "ar"], brandVoice: true };

export type OpenBatch = { batch: BatchView; items: BatchItemView[] };

/** Bulk Copy: a CSV or SKU list written in the background, one queued job (and credit) per product. */
export function BulkCopyWorkspace() {
  const t = useTranslations("CopyBulk");
  const tw = useTranslations("Workspace");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [category, setCategory] = useState(categoryPresets[0].key);
  const [style, setStyle] = useState<CopyStyle>(initialStyle);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<BatchView[]>([]);
  const [brand, setBrand] = useState<BrandSummary>(undefined);
  const [rights, setRights] = useState<ReviewRights | null>(null);
  const [open, setOpen] = useState<OpenBatch | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseBatchInput(text, CATEGORY_KEYS), [text]);
  const count = parsed.rows.length;

  useEffect(() => {
    listCopyBatches().then(setRuns);
    getBrandKitSummary().then(setBrand);
    getCopyReviewRights().then(setRights);
  }, []);

  const openId = open?.batch.id;
  const running = open?.batch.status === "running";
  useEffect(() => {
    if (!openId || !running) return;
    const timer = setInterval(async () => {
      const fresh = await getCopyBatch(openId);
      if (!fresh) return;
      setOpen(fresh);
      setRuns((r) => r.map((b) => (b.id === openId ? fresh.batch : b)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [openId, running]);

  function failure(result: BatchFailure, needed: number) {
    const blocked = blockedReason(result.error);
    if (blocked) return tw(`blocked.${blocked}.title`);
    if (result.error === "not_enough_credits") return t("errors.notEnoughCredits", { count: needed });
    if (result.error === "empty" || result.error === "forbidden" || result.error === "invalid_input") return t(`errors.${result.error}`);
    return t("errors.failed");
  }

  function start() {
    if (!count || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startCopyBatch({ text, name: fileName ?? undefined, settings: { category, ...style } });
      if (!result.ok) {
        setError(failure(result, count));
        return;
      }
      setRuns((r) => [result.batch, ...r]);
      setText("");
      setFileName(null);
      showRun(result.batch.id);
    });
  }

  async function showRun(id: string) {
    const run = await getCopyBatch(id);
    if (run) setOpen(run);
  }

  async function loadFile(file: File | null) {
    if (!file) return;
    setFileName(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
    setText(await file.text());
  }

  return (
    <>
      <ConfigPanel onSubmit={start}>
        <PanelHeader title={t("panelTitle")} />

        <PanelBody disabled={pending}>
          <CopyModeTabs mode="bulk" />

          <Section title={t("products")} aside={<RequiredTag />}>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <FileSpreadsheet className="size-4 shrink-0 text-subtle" aria-hidden />
              <button type="button" onClick={() => fileRef.current?.click()} className="min-w-0 flex-1 truncate text-start text-xs text-subtle">
                {fileName ? <bdi className="text-foreground">{fileName}</bdi> : t("upload")}
              </button>
              <button type="button" onClick={() => download("imagine-bulk-copy-template.csv", BATCH_TEMPLATE_CSV, "text/csv;charset=utf-8")} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
                <Download className="size-3" aria-hidden />
                {t("template")}
              </button>
              <HiddenFileInput inputRef={fileRef} accept=".csv,.txt,text/csv,text/plain" onChange={loadFile} />
            </div>
            <Field label={t("paste")} htmlFor="bulk-rows">
              <Textarea
                id="bulk-rows"
                dir="ltr"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                placeholder={t("pastePlaceholder")}
                spellCheck={false}
                className="h-36 min-h-36 resize-none rounded-lg bg-muted p-3 font-mono text-[11px] leading-[1.5] placeholder:text-subtle md:text-[11px]"
              />
            </Field>
            <p className="text-[11px] leading-normal text-muted-foreground">{t("formatHint")}</p>
            {text.trim() !== "" && (
              <div className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-[11px]" aria-live="polite">
                <span className="font-semibold">{t("summary", { count })}</span>
                {parsed.truncated && <span className="text-amber-600">{t("truncated", { max: BATCH_MAX_ROWS })}</span>}
                {parsed.problems.length > 0 && (
                  <>
                    <span className="text-amber-600">{t("skipped", { count: parsed.problems.length })}</span>
                    <ul className="flex flex-col gap-0.5 text-muted-foreground">
                      {parsed.problems.slice(0, 5).map((p) => (
                        <li key={p.line}>{t("problem", { line: p.line, reason: t(`problems.${p.reason}`) })}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </Section>

          <Section title={t("style")}>
            <CategorySelect id="bulk-category" label={t("defaultCategory")} value={category} onChange={setCategory} />
            <CopyStyleFields idPrefix="bulk" value={style} brand={brand} onChange={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
          </Section>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-[#ef4444]">
              {error}
            </p>
          )}
        </PanelBody>

        <PanelFooter
          cost={count}
          submitLabel={t("start", { count })}
          canSubmit={count > 0 && style.languages.length > 0}
          busy={pending}
          onReset={() => {
            setText("");
            setFileName(null);
            setCategory(categoryPresets[0].key);
            setStyle(initialStyle);
            setError(null);
          }}
        />
      </ConfigPanel>

      <BulkCanvas
        rights={rights}
        open={open}
        runs={runs}
        onShow={showRun}
        onChanged={(run) => {
          if (!run) return;
          setOpen(run);
          setRuns((r) => r.map((b) => (b.id === run.batch.id ? run.batch : b)));
        }}
        onDeleted={(id) => {
          setOpen(null);
          setRuns((r) => r.filter((b) => b.id !== id));
        }}
      />
    </>
  );
}
