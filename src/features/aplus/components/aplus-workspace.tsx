"use client";

import { blockedReason, type BlockedReason } from "@/components/app/job-errors";
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import {
  ConfigPanel,
  Field,
  FormatFields,
  PanelBody,
  PanelFooter,
  PanelHeader,
  RequiredTag,
  Section,
} from "@/components/app/config-panel";
import { ExportDialog } from "@/components/app/export-dialog";
import { useObjectUrl } from "@/components/app/upload-inputs";
import { Input } from "@/components/ui/input";
import { CatalogFetch } from "@/features/catalog/components/catalog-fetch";
import type { AplusFeature, GeneratedImage } from "@/lib/ai/types";
import { categoryPresets } from "@/lib/catalog-presets";
import { useCategoryParam, useCategorySync, useSubcategorySync } from "@/lib/use-category-param";
import { SubcategoryField } from "@/components/app/subcategory-field";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { saveGeneration } from "@/features/history/actions";
import { ResultFeed, useToolFeed } from "@/components/app/result-feed";
import { generateAplusImage } from "../actions";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { TEXT_LIMITS } from "../config";
import { AplusCanvas, type AplusCanvasState, type AplusDraft } from "./aplus-canvas";
import { FeatureBlocks, ProductSourceInput, ReferencePicker, type ProductSource, type ReferenceChoice } from "./aplus-inputs";
import { useJobCost } from "@/features/credits/use-job-cost";
import { useOrgCatalog } from "@/components/app/org-catalog";

type FormState = {
  sku: string;
  product: ProductSource;
  reference: ReferenceChoice;
  category: string;
  scene: string | null;
  style: string | null;
  title: string;
  subtitle: string;
  features: AplusFeature[];
  aspectRatio: AspectRatio;
  resolution: Resolution;
};

type Outcome = { kind: "result"; image: GeneratedImage } | { kind: "failed"; reason: "generation" | "input" | "url" | BlockedReason };

const initialState: FormState = {
  sku: "",
  product: { kind: "file", file: null },
  reference: { kind: "none" },
  // Nothing is pre-picked: the merchant chooses the category (scene and style stay optional).
  category: "",
  scene: null,
  style: null,
  title: "",
  subtitle: "",
  features: [
    { title: "", description: "" },
    { title: "", description: "" },
  ],
  aspectRatio: "1:1",
  resolution: "HD",
};

export function AplusWorkspace() {
  const jobCost = useJobCost("aplus");
  const t = useTranslations("Aplus");
  const tw = useTranslations("Workspace");
  const tp = useTranslations("Presets");
  const { categories: orgCategories, storedType } = useOrgCatalog();
  const locale = useLocale();
  const searchParams = useSearchParams();
  // History → "Open in tool" passes ?sku= so the merchant can regenerate for the same product;
  // the template picker and the other tools pass ?category=.
  const paramCategory = useCategoryParam();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialState,
    sku: searchParams.get("sku")?.slice(0, 64) ?? "",
    ...(paramCategory ? { category: paramCategory } : {}),
  }));
  const chooseCategory = useCategorySync(form.category, (category) =>
    setForm((f) => ({ ...f, category, scene: null, style: null })),
  );
  const [subcategory, chooseSubcategory] = useSubcategorySync(form.category);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const feed = useToolFeed("aplus");
  // The current result's History id: it shows in the canvas, so it is hidden from the feed.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [committedUrl, setCommittedUrl] = useState("");
  const runId = useRef(0);
  const titleRef = useRef<HTMLInputElement>(null);

  const productFile = form.product.kind === "file" ? form.product.file : null;
  const filePreview = useObjectUrl(productFile);
  const referenceFile = form.reference.kind === "upload" ? form.reference.file : null;
  const referencePreview = useObjectUrl(referenceFile);
  const productPreview =
    form.product.kind === "file"
      ? filePreview
      : committedUrl.startsWith("https://") && committedUrl === form.product.url.trim()
        ? committedUrl
        : null;

  const preset = categoryPresets.find((c) => c.key === form.category) ?? categoryPresets[0];
  const hasProduct = form.product.kind === "file" ? productFile !== null : form.product.url.trim() !== "";
  const featuresComplete = form.features.every((f) => f.title.trim() && f.description.trim());
  const canSubmit = form.category !== "" && form.sku.trim() !== "" && hasProduct && form.title.trim() !== "" && featuresComplete;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const draft: AplusDraft = {
    product: productPreview,
    scene: preset.scenes.find((s) => s.key === form.scene)?.image ?? null,
    layout: form.reference.kind === "library" ? form.reference.layout : form.reference.kind === "upload" ? "gallery" : "bento",
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    features: form.features,
    aspectRatio: form.aspectRatio,
  };

  async function generate() {
    if (!canSubmit || generating) return;
    const id = ++runId.current;
    const data = new FormData();
    data.set("sku", form.sku);
    if (form.product.kind === "file" && form.product.file) {
      data.set("productSource", "file");
      data.set("product", form.product.file);
    } else if (form.product.kind === "url") {
      data.set("productSource", "url");
      data.set("productUrl", form.product.url.trim());
    }
    data.set("referenceKind", form.reference.kind);
    if (form.reference.kind === "library") data.set("referenceLayout", form.reference.layout);
    if (form.reference.kind === "upload") data.set("reference", form.reference.file);
    data.set("category", form.category);
    if (subcategory) data.set("subcategory", subcategory);
    if (form.scene) data.set("scene", form.scene);
    if (form.style) data.set("style", form.style);
    data.set("title", form.title);
    data.set("subtitle", form.subtitle);
    data.set("features", JSON.stringify(form.features));
    data.set("aspectRatio", form.aspectRatio);
    data.set("resolution", form.resolution);

    setGenerating(true);
    setComparing(false);
    const result = await generateAplusImage(data);
    if (id !== runId.current) return;
    setGenerating(false);
    setSavedId(null);
    if (result.ok) void saveResult(result.image);
    setOutcome(
      result.ok
        ? { kind: "result", image: result.image }
        : { kind: "failed", reason: result.error === "invalid_input" ? "input" : result.error === "invalid_url" ? "url" : (blockedReason(result.error) ?? "generation") },
    );
  }

  // Every result is saved to History as it arrives (the results feed); Export then only downloads.
  async function saveResult(image: GeneratedImage) {
    const saved = await saveGeneration({
      mode: "aplus",
      sku: form.sku.trim(),
      title: form.title.trim(),
      imageUrl: image.url,
      width: image.width,
      height: image.height,
      provider: image.provider,
      model: image.model,
      settings: {
        title: form.title,
        subtitle: form.subtitle || null,
        features: JSON.stringify(form.features),
        layout: draft.layout,
        subcategory: storedType(form.category, subcategory),
        scene: form.scene,
        style: form.style,
        aspectRatio: form.aspectRatio,
        resolution: form.resolution,
      },
    }).catch(() => null);
    if (!saved?.ok) return false;
    setSavedId(saved.id);
    feed.track(saved.id);
    return true;
  }

  function editDetails() {
    setOutcome((o) => (o?.kind === "failed" ? null : o));
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function download() {
    if (outcome?.kind !== "result") return;
    const a = document.createElement("a");
    a.href = outcome.image.url;
    a.download = `${form.sku.trim() || "product"}_aplus.webp`;
    a.click();
  }

  const canvasState: AplusCanvasState = generating
    ? { kind: "generating", draft }
    : outcome?.kind === "result"
      ? { kind: "result", image: outcome.image, source: productPreview }
      : outcome?.kind === "failed"
        ? { kind: "failed", reason: outcome.reason }
        : productPreview || draft.title
          ? { kind: "preview", draft }
          : { kind: "empty" };

  return (
    <>
      <ConfigPanel tool="aplus" onSubmit={generate}>
        <PanelHeader title={t("panelTitle")} />

        <PanelBody disabled={generating}>
          <BulkModeTabs tool="/aplus" mode="single" />
          <Section title={t("productInfo")} aside={<RequiredTag />}>
            <Field label={t("sku")} htmlFor="sku">
              <Input
                id="sku"
                value={form.sku}
                maxLength={64}
                onChange={(e) => set("sku", e.target.value)}
                placeholder={t("skuPlaceholder")}
                className="h-auto rounded-lg px-3 py-2 text-[13px] placeholder:text-subtle md:text-[13px]"
              />
            </Field>
            <CatalogFetch
              sku={form.sku}
              disabled={generating}
              onImport={(file, product) =>
                setForm((f) => ({
                  ...f,
                  product: { kind: "file", file },
                  title: f.title || ((locale === "ar" && product.nameAr) || product.name).slice(0, TEXT_LIMITS.title),
                }))
              }
            />
            <Field label={t("productImage")}>
              <ProductSourceInput
                value={form.product}
                preview={filePreview}
                onChange={(value) => set("product", value)}
                onUrlCommit={setCommittedUrl}
              />
            </Field>
          </Section>

          <Section title={t("reference")}>
            <p className="-mt-1 text-[11px] leading-[1.4] text-muted-foreground">{t("referenceHint")}</p>
            <ReferencePicker value={form.reference} preview={referencePreview} onChange={(value) => set("reference", value)} />
          </Section>

          <Section title={t("sceneStyle")} aside={form.category === "" ? <RequiredTag /> : undefined} summary={form.category ? tp(`categories.${form.category}`) : null}>
            <Field label={t("category")} htmlFor="category">
              <div className="relative">
                <select
                  id="category"
                  value={form.category}
                  onChange={(e) => chooseCategory(e.target.value)}
                  className="w-full appearance-none rounded-lg border bg-transparent py-2 ps-3 pe-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="" disabled>
                    {tw("chooseCategory")}
                  </option>
                  {orgCategories(form.category).map((c) => (
                    <option key={c.key} value={c.key}>
                      {tp(`categories.${c.key}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
              </div>
            </Field>
            <SubcategoryField id="subcategory" category={form.category} value={subcategory} onChange={chooseSubcategory} />
            {form.category === "" ? (
              <p className="text-xs text-muted-foreground">{tw("chooseFirst")}</p>
            ) : (
              <>
                <Field label={t("scenes")} gap="gap-1.5">
                  <div role="radiogroup" aria-label={t("scenes")} className="flex flex-wrap gap-2">
                    {preset.scenes.map((scene) => {
                      const selected = form.scene === scene.key;
                      return (
                        <button
                          key={scene.key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => set("scene", selected ? null : scene.key)}
                          className={cn(
                            "flex h-[110px] w-[118px] flex-col overflow-hidden rounded-xl border bg-muted text-start",
                            selected && "border-2 border-primary",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- tenant-configurable preset images */}
                          <img src={scene.image} alt="" className="h-[70px] w-full shrink-0 object-cover" />
                          <span className="w-full truncate p-1.5 text-[11px] font-semibold">{tp(`scenes.${scene.key}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label={t("style")} gap="gap-1.5">
                  <div role="radiogroup" aria-label={t("style")} className="flex flex-wrap gap-1.5">
                    {preset.styles.map((style) => {
                      const selected = form.style === style;
                      return (
                        <button
                          key={style}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => set("style", selected ? null : style)}
                          className={cn(
                            "rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground",
                            selected && "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          {tp(`styles.${style}`)}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </>
            )}
          </Section>

          <Section title={t("textContent")}>
            <Field label={t("mainTitle")} htmlFor="title">
              <Input
                ref={titleRef}
                id="title"
                value={form.title}
                maxLength={TEXT_LIMITS.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="h-auto rounded-lg px-3 py-2 text-[13px] placeholder:text-subtle md:text-[13px]"
              />
            </Field>
            <Field label={t("subtitle")} htmlFor="subtitle">
              <Input
                id="subtitle"
                value={form.subtitle}
                maxLength={TEXT_LIMITS.subtitle}
                onChange={(e) => set("subtitle", e.target.value)}
                placeholder={t("subtitlePlaceholder")}
                className="h-auto rounded-lg px-3 py-2 text-[13px] placeholder:text-subtle md:text-[13px]"
              />
            </Field>
            <FeatureBlocks value={form.features} onChange={(value) => set("features", value)} />
          </Section>

          <Section title={t("output")}>
            <FormatFields
              aspectRatio={form.aspectRatio}
              onAspectRatioChange={(value) => set("aspectRatio", value)}
              resolution={form.resolution}
              onResolutionChange={(value) => set("resolution", value)}
            />
          </Section>
        </PanelBody>

        <PanelFooter
          cost={jobCost}
          submitLabel={t("submit")}
          canSubmit={canSubmit}
          busy={generating}
          onReset={() => {
            runId.current++;
            // Reset clears the job but keeps the category (the template it started from), as in Generate.
            setForm((f) => ({ ...initialState, category: f.category }));
            setOutcome(null);
            setGenerating(false);
            setComparing(false);
          }}
        />
      </ConfigPanel>

      <ResultFeed items={feed.items} hideIds={savedId ? [savedId] : []} />

      <AplusCanvas
        sku={form.sku.trim()}
        state={canvasState}
        comparing={comparing}
        onToggleCompare={() => setComparing((c) => !c)}
        onCancel={() => {
          // The provider call still finishes server-side; its result is discarded.
          runId.current++;
          setGenerating(false);
        }}
        onRegenerate={generate}
        onEditDetails={editDetails}
        onExport={() => setExportOpen(true)}
        onDownload={download}
      />

      {outcome?.kind === "result" && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          image={outcome.image}
          filenameBase={`${form.sku.trim()}_aplus_v1`}
          aspectRatio={form.aspectRatio}
          resolution={form.resolution}
          onSave={async () => (savedId ? true : saveResult(outcome.image))}
        />
      )}
    </>
  );
}
