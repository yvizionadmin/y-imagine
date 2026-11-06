"use client";

import { blockedReason, type BlockedReason } from "@/components/app/job-errors";
import { useRef, useState } from "react";
import { ChevronDown, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import {
  ConfigPanel,
  Field,
  FormatFields,
  ImproveWithAiButton,
  OptionalTag,
  PanelBody,
  PanelFooter,
  PanelHeader,
  ReadyTag,
  RequiredTag,
  Section,
} from "@/components/app/config-panel";
import { ProductDropzone, useObjectUrl } from "@/components/app/upload-inputs";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import { Input } from "@/components/ui/input";
import { CatalogFetch } from "@/features/catalog/components/catalog-fetch";
import { Textarea } from "@/components/ui/textarea";
import { RECOLOR_SCOPES, type GeneratedImage, type PreservationCheck, type RecolorScope } from "@/lib/ai/types";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { categoryPresets } from "@/lib/catalog-presets";
import { useCategoryParam, useCategorySync, useSubcategorySync } from "@/lib/use-category-param";
import { SubcategoryField } from "@/components/app/subcategory-field";
import { saveGeneration } from "@/features/history/actions";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { analyzeSwatch, recolorProduct } from "../actions";
import { RecolorCanvas, type RecolorCanvasState } from "./recolor-canvas";
import { swatchDisplayName, SwatchPicker, type SwatchState } from "./swatch-picker";
import { useJobCost } from "@/features/credits/use-job-cost";

type FormState = {
  category: string;
  sku: string;
  product: File | null;
  swatch: File | null;
  scope: RecolorScope;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  notes: string;
};

type Outcome =
  | { kind: "result"; image: GeneratedImage; preserved: PreservationCheck[] }
  | { kind: "failed"; reason: "generation" | "input" | BlockedReason };

const initialState: FormState = {
  category: categoryPresets[0].key,
  sku: "",
  product: null,
  swatch: null,
  scope: "main",
  aspectRatio: "1:1",
  resolution: "HD",
  notes: "",
};

export function RecolorWorkspace() {
  const jobCost = useJobCost("recolor");
  const t = useTranslations("Recolor");
  const tp = useTranslations("Presets");
  const th = useTranslations("PromptHints");
  const searchParams = useSearchParams();
  // History → "Open in tool" passes ?sku= so the merchant can regenerate for the same product;
  // the template picker and Generate pass ?category=, which sets the wording (fabric, finish…).
  const paramCategory = useCategoryParam();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialState,
    sku: searchParams.get("sku")?.slice(0, 64) ?? "",
    ...(paramCategory ? { category: paramCategory } : {}),
  }));
  const chooseCategory = useCategorySync(form.category, (category) => setForm((f) => ({ ...f, category })));
  const [subcategory, chooseSubcategory] = useSubcategorySync(form.category);
  const preset = categoryPresets.find((c) => c.key === form.category) ?? categoryPresets[0];
  const kind = preset.recolorKind;
  const tk = (key: string) => t(`kinds.${kind}.${key}`);
  const [swatchState, setSwatchState] = useState<SwatchState | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [generating, setGenerating] = useState(false);
  const [used, setUsed] = useState(false);
  // Monotonic ids let us ignore responses that were cancelled or superseded.
  const runId = useRef(0);
  const swatchRunId = useRef(0);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const productPreview = useObjectUrl(form.product);
  const swatchPreview = useObjectUrl(form.swatch);
  const hex = swatchState?.status === "ready" ? swatchState.analysis.hex : null;
  const productReady = form.sku.trim() !== "" && form.product !== null;
  const canSubmit = productReady && hex !== null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function changeSwatch(file: File | null) {
    set("swatch", file);
    const id = ++swatchRunId.current;
    if (!file) return setSwatchState(null);
    setSwatchState({ status: "analyzing" });
    const data = new FormData();
    data.set("swatch", file);
    const result = await analyzeSwatch(data);
    if (id !== swatchRunId.current) return;
    setSwatchState(result.ok ? { status: "ready", analysis: result.analysis } : { status: "error" });
  }

  async function recolor() {
    if (!form.product || !form.swatch || !hex || generating) return;
    const id = ++runId.current;
    const data = new FormData();
    data.set("sku", form.sku);
    data.set("category", form.category);
    if (subcategory) data.set("subcategory", subcategory);
    data.set("product", form.product);
    data.set("swatch", form.swatch);
    data.set("hex", hex);
    data.set("scope", form.scope);
    data.set("aspectRatio", form.aspectRatio);
    data.set("resolution", form.resolution);
    data.set("notes", form.notes);

    setGenerating(true);
    const result = await recolorProduct(data);
    if (id !== runId.current) return;
    setGenerating(false);
    setUsed(false);
    setOutcome(
      result.ok
        ? { kind: "result", image: result.image, preserved: result.preserved }
        : { kind: "failed", reason: result.error === "invalid_input" ? "input" : (blockedReason(result.error) ?? "generation") },
    );
  }

  function cancel() {
    // The provider call still finishes server-side; its result is discarded.
    runId.current++;
    setGenerating(false);
  }

  function editNotes() {
    setOutcome((o) => (o?.kind === "failed" ? null : o));
    notesRef.current?.focus();
    notesRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function download() {
    if (outcome?.kind !== "result") return;
    const a = document.createElement("a");
    a.href = outcome.image.url;
    a.download = `${form.sku.trim() || "product"}_recolor.webp`;
    a.click();
  }

  async function useImage() {
    if (outcome?.kind !== "result") return;
    const result = await saveGeneration({
      mode: "recolor",
      sku: form.sku.trim(),
      title: form.swatch ? swatchDisplayName(form.swatch.name) : "",
      imageUrl: outcome.image.url,
      width: outcome.image.width,
      height: outcome.image.height,
      provider: outcome.image.provider,
      model: outcome.image.model,
      settings: {
        category: form.category,
        subcategory,
        swatch: form.swatch?.name ?? null,
        hex,
        scope: form.scope,
        aspectRatio: form.aspectRatio,
        resolution: form.resolution,
        notes: form.notes || null,
      },
    });
    setUsed(result.ok);
  }

  const canvasState: RecolorCanvasState = generating
    ? { kind: "generating", src: productPreview }
    : outcome?.kind === "result"
      ? { kind: "result", image: outcome.image, source: productPreview, preserved: outcome.preserved }
      : outcome?.kind === "failed"
        ? { kind: "failed", reason: outcome.reason }
        : productPreview
          ? { kind: "preview", src: productPreview }
          : { kind: "empty" };

  return (
    <>
      <ConfigPanel onSubmit={() => canSubmit && recolor()}>
        <PanelHeader title={tk("panelTitle")} />

        <PanelBody disabled={generating}>
          <BulkModeTabs tool="/recolor" mode="single" />
          <Section title={t("productInfo")} aside={productReady ? <ReadyTag /> : <RequiredTag />}>
            <Field label={t("category")} htmlFor="category">
              <div className="relative">
                <select
                  id="category"
                  value={form.category}
                  onChange={(e) => chooseCategory(e.target.value)}
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
            <SubcategoryField id="subcategory" category={form.category} value={subcategory} onChange={chooseSubcategory} />
            <Field label={t("sku")} htmlFor="sku">
              <div className="relative">
                <Input
                  id="sku"
                  value={form.sku}
                  maxLength={64}
                  onChange={(e) => set("sku", e.target.value)}
                  placeholder={t("skuPlaceholder", { sku: preset.skuPlaceholder })}
                  className="h-auto rounded-lg py-2 ps-3 pe-8 font-mono text-[13px] placeholder:text-subtle md:text-[13px]"
                />
                {form.sku.trim() && (
                  <CircleCheck className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-emerald-500" aria-hidden />
                )}
              </div>
            </Field>
            <CatalogFetch sku={form.sku} disabled={generating} onImport={(file) => set("product", file)} />
            <ProductDropzone
              file={form.product}
              preview={productPreview}
              onChange={(file) => set("product", file)}
              title={t("uploadTitle")}
              hint={t("uploadHint")}
            />
          </Section>

          <Section title={tk("color")}>
            <p className="-mt-1 text-[11px] leading-[1.4] text-[#6b7280]">{tk("colorHint")}</p>
            <SwatchPicker title={tk("swatchUploadTitle")} file={form.swatch} preview={swatchPreview} state={swatchState} onChange={changeSwatch} />
            <Field label={t("scope")} gap="gap-1.5">
              <div role="radiogroup" aria-label={t("scope")} className="flex flex-wrap gap-1.5">
                {RECOLOR_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    role="radio"
                    aria-checked={form.scope === scope}
                    onClick={() => set("scope", scope)}
                    className={cn(
                      "rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground",
                      form.scope === scope && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {t(`scopes.${scope}`)}
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title={t("format")}>
            <FormatFields
              aspectRatio={form.aspectRatio}
              onAspectRatioChange={(value) => set("aspectRatio", value)}
              resolution={form.resolution}
              onResolutionChange={(value) => set("resolution", value)}
            />
          </Section>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="notes" className="text-[11px] font-bold uppercase">
                {t("notes")}
              </label>
              <OptionalTag />
            </div>
            <Textarea
              ref={notesRef}
              id="notes"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={tk("notesPlaceholder")}
              className="h-[52px] min-h-[52px] resize-none rounded-lg bg-muted px-2.5 py-2.5 text-[11px] placeholder:text-subtle md:text-[11px]"
            />
            <PromptChips chips={th.raw(`recolor.${kind}`) as string[]} value={form.notes} max={2000} onChange={(value) => set("notes", value)} />
            <PromptTips text={form.notes} />
            <div className="flex">
              <ImproveWithAiButton value={form.notes} onChange={(value) => set("notes", value)} request={{ tool: "recolor", category: form.category }} />
            </div>
          </div>
        </PanelBody>

        <PanelFooter
          cost={jobCost}
          submitLabel={tk("submit")}
          canSubmit={canSubmit}
          busy={generating}
          onReset={() => {
            runId.current++;
            swatchRunId.current++;
            // Reset clears the job but keeps the category (the template it started from).
            setForm((f) => ({ ...initialState, category: f.category }));
            setSwatchState(null);
            setOutcome(null);
            setGenerating(false);
          }}
        />
      </ConfigPanel>

      <RecolorCanvas
        kind={kind}
        state={canvasState}
        onCancel={cancel}
        onRegenerate={recolor}
        onEditNotes={editNotes}
        onDownload={download}
        onUseImage={useImage}
        used={used}
      />
    </>
  );
}
