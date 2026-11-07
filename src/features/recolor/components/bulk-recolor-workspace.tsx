"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Palette, PenLine, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { chipLabel, ConfigPanel, shorten, Field, FormatFields, OptionalTag, ReadyTag, RequiredTag, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import { useObjectUrl } from "@/components/app/upload-inputs";
import { Textarea } from "@/components/ui/textarea";
import { CategoryFields } from "@/features/image-batch/components/bulk-fields";
import { BulkImageCanvas } from "@/features/image-batch/components/bulk-image-canvas";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { ProductListField, StartErrorBox, useStartError, type StartError } from "@/features/image-batch/components/product-list-field";
import { useImageRuns } from "@/features/image-batch/components/use-image-runs";
import { RECOLOR_SCOPES, type RecolorScope } from "@/lib/ai/types";
import { categoryPresets, findCategory, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { IMAGE_BATCH_MAX_ROWS, parseImageRows } from "@/lib/image-batch/rows";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { analyzeSwatch } from "../actions";
import { startRecolorBatch } from "../batch-actions";
import { swatchDisplayName, SwatchPicker, type SwatchState } from "./swatch-picker";
import { useJobCost } from "@/features/credits/use-job-cost";

const TEMPLATE = { name: "imagine-bulk-recolor-template.csv", csv: "sku\nSOFA-2041\nSOFA-2042\n" };

/** Bulk Recolor: one swatch colour applied to every SKU's catalog photo, in the background. */
export function BulkRecolorWorkspace() {
  const t = useTranslations("RecolorBulk");
  const ti = useTranslations("ImageBulk");
  const tr = useTranslations("Recolor");
  const th = useTranslations("PromptHints");
  const tw = useTranslations("Workspace");
  const startError = useStartError();
  const runs = useImageRuns();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  // Nothing is pre-picked: the merchant chooses the category.
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [swatch, setSwatch] = useState<File | null>(null);
  const [swatchState, setSwatchState] = useState<SwatchState | null>(null);
  const [scope, setScope] = useState<RecolorScope>("main");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("HD");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<StartError | null>(null);
  const [pending, startTransition] = useTransition();
  // Ignores a swatch analysis that finished after the swatch was replaced.
  const swatchRunId = useRef(0);
  const swatchPreview = useObjectUrl(swatch);
  const parsed = useMemo(() => parseImageRows(text, PRODUCT_SIZE_MAX), [text]);
  const count = parsed.rows.length;
  const unitCost = useJobCost("recolor");
  const kind = (findCategory(category) ?? categoryPresets[0]).recolorKind;
  const tk = (key: string) => tr(`kinds.${kind}.${key}`);
  const hex = swatchState?.status === "ready" ? swatchState.analysis.hex : null;
  const canSubmit = count > 0 && category !== "" && swatch !== null && hex !== null;

  async function changeSwatch(file: File | null) {
    setSwatch(file);
    const id = ++swatchRunId.current;
    if (!file) return setSwatchState(null);
    setSwatchState({ status: "analyzing" });
    const data = new FormData();
    data.set("swatch", file);
    const result = await analyzeSwatch(data);
    if (id !== swatchRunId.current) return;
    setSwatchState(result.ok ? { status: "ready", analysis: result.analysis } : { status: "error" });
  }

  function start() {
    if (pending) return;
    if (!swatch || !hex) return setError({ message: ti("errors.no_swatch") });
    if (!count) return;
    setError(null);
    const data = new FormData();
    data.set("text", text);
    if (fileName) data.set("name", fileName);
    data.set("category", category);
    if (subcategory) data.set("subcategory", subcategory);
    data.set("swatch", swatch);
    data.set("hex", hex);
    data.set("scope", scope);
    data.set("aspectRatio", aspectRatio);
    data.set("resolution", resolution);
    data.set("notes", notes);
    // Same History title as single Recolor: the swatch's name.
    data.set("title", swatchDisplayName(swatch.name));
    startTransition(async () => {
      const result = await startRecolorBatch(data);
      if (!result.ok) {
        const blocked = blockedReason(result.error);
        return setError(startError(result.error, count * unitCost, blocked ? tw(`blocked.${blocked}.title`) : null));
      }
      runs.started(result.batch);
      setText("");
      setFileName(null);
    });
  }

  return (
    <>
      <ConfigPanel tool="recolor" onSubmit={start}>
        <PanelHeader title={t("panelTitle")} />

        <PanelBody disabled={pending}>
          <BulkModeTabs tool="/recolor" mode="bulk" />

          <ProductListField
            text={text}
            fileName={fileName}
            onText={(value) => {
              setText(value);
              setError(null);
            }}
            onFile={(name, value) => {
              setFileName(name);
              setText(value);
            }}
            summary={{
              count,
              truncated: parsed.truncated,
              problems: parsed.skipped.map((p) => ({ key: String(p.line), text: ti("problem", { line: p.line, reason: ti(`problems.${p.reason}`) }) })),
            }}
            placeholder={t("pastePlaceholder")}
            hint={t("formatHint", { max: IMAGE_BATCH_MAX_ROWS })}
            template={TEMPLATE}
          />

          <Section title={tk("color")} aside={swatch && category ? <ReadyTag /> : <RequiredTag />} summary={swatch?.name} icon={<Palette className="size-3.5 shrink-0" aria-hidden />}>
            <CategoryFields
              label={tr("category")}
              category={category}
              subcategory={subcategory}
              onCategory={(key) => {
                setCategory(key);
                setSubcategory(null);
              }}
              onSubcategory={setSubcategory}
            />
            <p className="-mt-1 text-[11px] leading-[1.4] text-muted-foreground">{tk("colorHint")}</p>
            <SwatchPicker title={tk("swatchUploadTitle")} file={swatch} preview={swatchPreview} state={swatchState} onChange={changeSwatch} />
            <Field label={tr("scope")} gap="gap-1.5">
              <div role="radiogroup" aria-label={tr("scope")} className="flex flex-wrap gap-1.5">
                {RECOLOR_SCOPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => setScope(s)}
                    className={cn("rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground", scope === s && "border-primary bg-primary text-primary-foreground")}
                  >
                    {tr(`scopes.${s}`)}
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title={tr("format")} summary={`${aspectRatio} · ${resolution}`} icon={<Square className="size-3.5 shrink-0" aria-hidden />}>
            <FormatFields aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} resolution={resolution} onResolutionChange={setResolution} />
          </Section>

          <Section title={tr("notes")} aside={<OptionalTag />} summary={shorten(notes)} icon={<PenLine className="size-3.5 shrink-0" aria-hidden />}>
            <label htmlFor="bulk-notes" className="sr-only">
              {chipLabel(tr("notes"))}
            </label>
            <Textarea
              id="bulk-notes"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tk("notesPlaceholder")}
              className="field-sizing-content max-h-40 min-h-16 cursor-text resize-none rounded-xl border border-input bg-muted/40 px-3 py-2.5 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground hover:border-ring/50 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm dark:bg-input/30"
            />
            <PromptChips chips={th.raw(`recolor.${kind}`) as string[]} value={notes} max={2000} onChange={setNotes} />
            <PromptTips text={notes} />
          </Section>

          <StartErrorBox error={error} />
        </PanelBody>

        <PanelFooter
          cost={count * unitCost}
          submitLabel={t("start", { count })}
          canSubmit={canSubmit}
          busy={pending}
          onReset={() => {
            swatchRunId.current++;
            setText("");
            setFileName(null);
            setSubcategory(null);
            setSwatch(null);
            setSwatchState(null);
            setScope("main");
            setAspectRatio("1:1");
            setResolution("HD");
            setNotes("");
            setError(null);
          }}
        />
      </ConfigPanel>

      <BulkImageCanvas open={runs.open} runs={runs.runs} onShow={runs.show} onChanged={runs.changed} onDeleted={runs.deleted} emptyTitle={t("emptyTitle")} emptyBody={t("emptyBody")} />
    </>
  );
}
