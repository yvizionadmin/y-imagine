"use client";

import { blockedReason, type BlockedReason } from "@/components/app/job-errors";
import { useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import {
  ConfigPanel,
  Field,
  FormatFields,
  ImproveWithAiButton,
  PanelBody,
  PanelFooter,
  PanelHeader,
  RequiredTag,
  Section,
} from "@/components/app/config-panel";
import { ExportDialog } from "@/components/app/export-dialog";
import { FilePickerRow, ProductDropzone, useObjectUrl } from "@/components/app/upload-inputs";
import { Input } from "@/components/ui/input";
import { CatalogFetch } from "@/features/catalog/components/catalog-fetch";
import { Textarea } from "@/components/ui/textarea";
import { ScenePicker, type SceneChoice } from "@/components/app/scene-picker";
import { SubcategoryField } from "@/components/app/subcategory-field";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import type { GeneratedImage } from "@/lib/ai/types";
import { saveGeneration } from "@/features/history/actions";
import { generateLifestyleImage } from "../actions";
import { categoryPresets, findCategory, findScene } from "@/lib/catalog-presets";
import { formatDimensions, SHOT_SET_ANGLES, type CameraAngle } from "@/lib/camera-angles";
import { useCategoryParam, useCategorySync, useSubcategorySync } from "@/lib/use-category-param";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { GENERATE_COST } from "../config";
import { GenerateCanvas, type CanvasState } from "./generate-canvas";
import { DimensionsField, ShotFields, type Dimensions, type ShotSettings } from "./shot-fields";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";

type FormState = {
  sku: string;
  product: File | null;
  reference: File | null;
  category: string;
  scene: SceneChoice;
  style: string | null;
  dimensions: Dimensions;
  shots: ShotSettings;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  instructions: string;
};

/** Each category starts on its top recommendation, so Generate works without picking a scene. */
const defaultScene = (category: string): SceneChoice => {
  const first = findCategory(category)?.scenes[0];
  return first ? { kind: "preset", key: first.key } : null;
};

type Outcome = { kind: "result"; image: GeneratedImage } | { kind: "failed"; reason: "generation" | "input" | BlockedReason };
/** One camera angle of a run: one image, one credit. */
type Shot = { angle: CameraAngle; outcome: Outcome | { kind: "pending" } };

/** A finished shot sent back as a file, so later shots can reuse its room. */
async function shotFile(url: string): Promise<File | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return new File([blob], "first-shot", { type: blob.type });
  } catch {
    return null;
  }
}

const initialState: FormState = {
  sku: "",
  product: null,
  reference: null,
  category: categoryPresets[0].key,
  scene: defaultScene(categoryPresets[0].key),
  style: null,
  dimensions: { w: "", h: "", d: "" },
  shots: { shotSet: "single", angles: SHOT_SET_ANGLES.single, keepScene: true, minimalProps: false },
  aspectRatio: "1:1",
  resolution: "HD",
  instructions: "",
};

export function GenerateWorkspace() {
  const t = useTranslations("Generate");
  const tp = useTranslations("Presets");
  const th = useTranslations("PromptHints");
  const searchParams = useSearchParams();
  // History → "Open in tool" passes ?sku= so the merchant can regenerate for the same product;
  // the template picker passes ?category= (used when that category has a preset) and ?sub=.
  const paramCategory = useCategoryParam();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialState,
    sku: searchParams.get("sku")?.slice(0, 64) ?? "",
    ...(paramCategory ? { category: paramCategory, scene: defaultScene(paramCategory) } : {}),
  }));
  const chooseCategory = useCategorySync(form.category, (category) =>
    // A described or uploaded scene isn't tied to a category, so it survives the switch.
    setForm((f) => ({ ...f, category, scene: f.scene?.kind === "custom" || f.scene?.kind === "upload" ? f.scene : defaultScene(category), style: null })),
  );
  const [subcategory, chooseSubcategory] = useSubcategorySync(form.category);
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [activeShot, setActiveShot] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const skuRef = useRef<HTMLInputElement>(null);
  const productPreview = useObjectUrl(form.product);

  const preset = categoryPresets.find((c) => c.key === form.category) ?? categoryPresets[0];
  const scenePreview = useObjectUrl(form.scene?.kind === "upload" ? form.scene.file : null);
  const sceneImage = form.scene?.kind === "preset" ? (findScene(form.scene.key)?.image ?? null) : scenePreview;
  const previewSrc = sceneImage ?? productPreview;
  const shot = shots?.[activeShot] ?? null;
  const outcome = shot?.outcome ?? null;
  const shotCount = form.shots.angles.length;
  const canSubmit =
    form.sku.trim() !== "" && form.product !== null && (form.scene?.kind !== "custom" || form.scene.prompt.trim() !== "");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canvasState: CanvasState =
    outcome?.kind === "pending" || (pending && !outcome)
    ? { kind: "generating", src: previewSrc }
    : outcome?.kind === "result"
      ? { kind: "result", image: outcome.image, source: productPreview }
      : outcome?.kind === "failed"
        ? { kind: "failed", reason: outcome.reason }
        : previewSrc
          ? { kind: "preview", src: previewSrc }
          : { kind: "empty" };

  function shotForm(angle: CameraAngle, matchShot: File | null) {
    const data = new FormData();
    data.set("sku", form.sku);
    data.set("product", form.product!);
    if (form.reference) data.set("reference", form.reference);
    data.set("category", form.category);
    if (subcategory) data.set("subcategory", subcategory);
    if (form.scene?.kind === "preset") data.set("scene", form.scene.key);
    if (form.scene?.kind === "custom") data.set("customScene", form.scene.prompt);
    if (form.scene?.kind === "upload") data.set("sceneImage", form.scene.file);
    if (form.style) data.set("style", form.style);
    data.set("productSize", formatDimensions(form.dimensions));
    data.set("angle", angle);
    if (form.shots.minimalProps) data.set("minimalProps", "1");
    if (matchShot) data.set("matchShot", matchShot);
    data.set("aspectRatio", form.aspectRatio);
    data.set("resolution", form.resolution);
    data.set("instructions", form.instructions);
    return data;
  }

  const setShot = (index: number, outcome: Shot["outcome"]) =>
    setShots((list) => list?.map((s, i) => (i === index ? { ...s, outcome } : s)) ?? null);

  async function runShot(index: number, angle: CameraAngle, matchShot: File | null): Promise<Outcome> {
    let next: Outcome;
    try {
      const result = await generateLifestyleImage(shotForm(angle, matchShot));
      next = result.ok
        ? { kind: "result", image: result.image }
        : { kind: "failed", reason: result.error === "invalid_input" ? "input" : (blockedReason(result.error) ?? "generation") };
    } catch {
      next = { kind: "failed", reason: "generation" };
    }
    setShot(index, next);
    return next;
  }

  // "Keep all scenes the same": the first shot sets the room; the rest are sent it as a reference.
  const keepScene = form.shots.keepScene && shotCount > 1;

  function generate() {
    if (!form.product || pending) return;
    const angles = form.shots.angles;
    setShots(angles.map((angle) => ({ angle, outcome: { kind: "pending" } })));
    setActiveShot(0);

    startTransition(async () => {
      const first = await runShot(0, angles[0], null);
      if (keepScene && first.kind === "failed") {
        // Without the first room there is nothing to match, and a blocked run would fail the same way.
        angles.slice(1).forEach((_, i) => setShot(i + 1, first));
        return;
      }
      const match = keepScene && first.kind === "result" ? await shotFile(first.image.url) : null;
      await Promise.all(angles.slice(1).map((angle, i) => runShot(i + 1, angle, match)));
    });
  }

  /** Regenerates the shot on screen (or the whole set when nothing has run yet). */
  function regenerate() {
    if (!shots || !shot || pending) return generate();
    const index = activeShot;
    const first = shots[0].outcome;
    setShot(index, { kind: "pending" });
    startTransition(async () => {
      const match = keepScene && index > 0 && first.kind === "result" ? await shotFile(first.image.url) : null;
      await runShot(index, shot.angle, match);
    });
  }

  function editDetails() {
    setShots((list) => (list?.length === 1 && list[0].outcome.kind === "failed" ? null : list));
    skuRef.current?.focus();
    skuRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <>
      <ConfigPanel onSubmit={() => canSubmit && generate()}>
        <PanelHeader title={form.sku.trim() || t("panelTitle")} />

        <PanelBody disabled={pending}>
          <BulkModeTabs tool="/generate" mode="single" />
          <Section title={t("productInfo")} aside={<RequiredTag />}>
            <Field label={t("sku")} htmlFor="sku">
              <Input
                ref={skuRef}
                id="sku"
                value={form.sku}
                maxLength={64}
                onChange={(e) => set("sku", e.target.value)}
                placeholder={t("skuPlaceholder", { sku: preset.skuPlaceholder })}
                className="h-auto rounded-lg px-3 py-2 font-mono text-[13px] placeholder:text-subtle md:text-[13px]"
              />
            </Field>
            <CatalogFetch sku={form.sku} onImport={(file) => set("product", file)} />
            <ProductDropzone
              file={form.product}
              preview={productPreview}
              onChange={(file) => set("product", file)}
              title={t("uploadTitle")}
              hint={t("uploadHint")}
            />
            <DimensionsField value={form.dimensions} onChange={(value) => set("dimensions", value)} />
            <Field label={t("reference")}>
              <FilePickerRow
                file={form.reference}
                onChange={(file) => set("reference", file)}
                placeholder={t("referencePlaceholder")}
              />
            </Field>
          </Section>

          <Section title={t("sceneSettings")}>
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

            <Field label={t("scenes")} gap="gap-1.5">
              <ScenePicker
                label={t("scenes")}
                recommended={preset.scenes}
                value={form.scene}
                onChange={(scene) => set("scene", scene)}
                chips={th.raw(`scenes.${form.category}`) as string[]}
              />
            </Field>

            <Field label={tp(`styleLabels.${preset.styleLabel}`)} gap="gap-1.5">
              <div role="radiogroup" aria-label={tp(`styleLabels.${preset.styleLabel}`)} className="flex flex-wrap gap-1.5">
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
          </Section>

          <Section title={t("shots.title")}>
            <ShotFields value={form.shots} onChange={(value) => set("shots", value)} />
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
              <label htmlFor="instructions" className="text-[11px] font-bold text-muted-foreground uppercase">
                {t("instructions")}
              </label>
              <ImproveWithAiButton
                value={form.instructions}
                onChange={(value) => set("instructions", value)}
                request={{
                  tool: "generate",
                  category: form.category,
                  scene: form.scene?.kind === "preset" ? form.scene.key : null,
                  customScene: form.scene?.kind === "custom" ? form.scene.prompt : null,
                }}
              />
            </div>
            <Textarea
              id="instructions"
              value={form.instructions}
              maxLength={2000}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder={t("instructionsPlaceholder")}
              className="h-20 min-h-20 resize-none rounded-lg bg-muted p-3 text-xs leading-[1.4] placeholder:text-subtle md:text-xs"
            />
            <PromptChips chips={th.raw("details") as string[]} value={form.instructions} max={2000} onChange={(value) => set("instructions", value)} />
            <PromptTips text={form.instructions} />
          </div>
        </PanelBody>

        <PanelFooter
          cost={GENERATE_COST * shotCount}
          submitLabel={shotCount > 1 ? t("generateShots", { count: shotCount }) : t("generate")}
          canSubmit={canSubmit}
          busy={pending}
          onReset={() => {
            // Reset clears the job but keeps the campaign's category (the template it started from).
            setForm((f) => ({ ...initialState, category: f.category, scene: defaultScene(f.category) }));
            setShots(null);
          }}
        />
      </ConfigPanel>

      <GenerateCanvas
        state={canvasState}
        shots={(shots ?? []).map((s) => ({
          angle: s.angle,
          status: s.outcome.kind === "result" ? "done" : s.outcome.kind === "failed" ? "failed" : "pending",
          src: s.outcome.kind === "result" ? s.outcome.image.url : null,
        }))}
        activeShot={activeShot}
        onSelectShot={setActiveShot}
        onRegenerate={regenerate}
        onEditDetails={editDetails}
        onExport={() => setExportOpen(true)}
      />

      {shot && outcome?.kind === "result" && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          image={outcome.image}
          filenameBase={`${form.sku.trim()}_lifestyle${shot.angle === "auto" ? "" : `_${shot.angle}`}_v1`}
          aspectRatio={form.aspectRatio}
          resolution={form.resolution}
          onSave={async () =>
            (
              await saveGeneration({
              mode: "lifestyle",
              sku: form.sku.trim(),
              title: [
                form.scene?.kind === "preset"
                  ? tp(`scenes.${form.scene.key}`)
                  : form.scene?.kind === "custom"
                    ? t("customScene")
                    : form.scene?.kind === "upload"
                      ? t("uploadedScene")
                      : subcategory
                        ? tp(`subcategories.${subcategory}`)
                        : tp(`categories.${form.category}`),
                form.style ? tp(`styles.${form.style}`) : null,
                shot.angle === "auto" ? null : t(`shots.angleNames.${shot.angle}`),
              ]
                .filter(Boolean)
                .join(" · "),
              imageUrl: outcome.image.url,
              width: outcome.image.width,
              height: outcome.image.height,
              provider: outcome.image.provider,
              model: outcome.image.model,
              settings: {
                category: form.category,
                subcategory,
                scene: form.scene?.kind === "preset" ? form.scene.key : null,
                customScene: form.scene?.kind === "custom" ? form.scene.prompt.trim() : null,
                sceneUpload: form.scene?.kind === "upload" ? form.scene.file.name : null,
                style: form.style,
                productSize: formatDimensions(form.dimensions) || null,
                angle: shot.angle,
                minimalProps: form.shots.minimalProps ? "true" : null,
                matchedFirstShot: keepScene && activeShot > 0 ? "true" : null,
                aspectRatio: form.aspectRatio,
                resolution: form.resolution,
                instructions: form.instructions || null,
              },
              })
            ).ok
          }
        />
      )}
    </>
  );
}
