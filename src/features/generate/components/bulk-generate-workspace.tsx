"use client";

import { useMemo, useState, useTransition } from "react";
import { Image as ImageIcon, PenLine, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { chipLabel, ConfigPanel, RequiredTag, shorten, Field, FormatFields, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import { ScenePicker, type SceneChoice } from "@/components/app/scene-picker";
import { Textarea } from "@/components/ui/textarea";
import { CategoryFields, StyleChips, CatalogImageSection } from "@/features/image-batch/components/bulk-fields";
import { BulkImageCanvas } from "@/features/image-batch/components/bulk-image-canvas";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { ProductListField, StartErrorBox, useStartError, type StartError } from "@/features/image-batch/components/product-list-field";
import { useImageRuns } from "@/features/image-batch/components/use-image-runs";
import { findCategory, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { IMAGE_BATCH_MAX_ROWS, parseImageRows } from "@/lib/image-batch/rows";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { startImageBatch } from "../batch-actions";
import { useJobCost } from "@/features/credits/use-job-cost";
import { jobsChanged } from "@/lib/jobs-events";

const TEMPLATE = { name: "imagine-bulk-images-template.csv", csv: "sku,product_size\nSOFA-2041,220 × 90 × 85 cm\nCHAIR-118,\n" };

/** Bulk Generate: a lifestyle image for every SKU in a list, from its catalog photo, in the background. */
export function BulkGenerateWorkspace() {
  const t = useTranslations("GenerateBulk");
  const ti = useTranslations("ImageBulk");
  const tg = useTranslations("Generate");
  const tp = useTranslations("Presets");
  const th = useTranslations("PromptHints");
  const tw = useTranslations("Workspace");
  const startError = useStartError();
  const runs = useImageRuns();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  // Nothing is pre-picked: the merchant chooses the category and the scene.
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneChoice>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("HD");
  const [instructions, setInstructions] = useState("");
  const [catalogImage, setCatalogImage] = useState(1);
  const [error, setError] = useState<StartError | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(() => parseImageRows(text, PRODUCT_SIZE_MAX), [text]);
  const count = parsed.rows.length;
  const unitCost = useJobCost("generate");
  const preset = findCategory(category) ?? null;

  function chooseCategory(key: string) {
    setCategory(key);
    setSubcategory(null);
    // A described scene isn't tied to a category, so it survives the switch.
    setScene((s) => (s?.kind === "custom" ? s : null));
    setStyle(null);
  }

  // The History title every image gets, in the UI language (same as single Generate).
  const title = [
    scene?.kind === "preset" ? tp(`scenes.${scene.key}`) : scene?.kind === "custom" ? tg("customScene") : subcategory ? tp(`subcategories.${subcategory}`) : category ? tp(`categories.${category}`) : null,
    style ? tp(`styles.${style}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const sceneChosen = category !== "" && scene !== null;
  const canSubmit = count > 0 && sceneChosen && (scene?.kind !== "custom" || scene.prompt.trim() !== "");

  function start() {
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startImageBatch({
        text,
        name: fileName ?? undefined,
        settings: {
          catalogImage,
          category,
          subcategory,
          scene: scene?.kind === "preset" ? scene.key : null,
          customScene: scene?.kind === "custom" ? scene.prompt.trim() : null,
          style,
          aspectRatio,
          resolution,
          instructions,
          title,
        },
      });
      jobsChanged();
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
      <ConfigPanel tool="generate" onSubmit={start}>
        <PanelHeader title={t("panelTitle")} />

        <PanelBody disabled={pending}>
          <BulkModeTabs tool="/generate" mode="bulk" />

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

          <Section title={tg("sceneSettings")} aside={sceneChosen ? undefined : <RequiredTag />} summary={title || null} icon={<ImageIcon className="size-3.5 shrink-0" aria-hidden />}>
            <CategoryFields label={tg("category")} category={category} subcategory={subcategory} onCategory={chooseCategory} onSubcategory={setSubcategory} />
            <Field label={tg("scenes")} gap="gap-1.5">
              {!preset && <p className="text-xs text-muted-foreground">{tw("chooseFirst")}</p>}
              <ScenePicker label={tg("scenes")} recommended={preset?.scenes ?? []} value={scene} onChange={setScene} chips={preset ? (th.raw(`scenes.${category}`) as string[]) : []} allowUpload={false} />
            </Field>
            {preset && <StyleChips category={category} value={style} onChange={setStyle} />}
          </Section>

          <CatalogImageSection value={catalogImage} onChange={setCatalogImage} />

          <Section title={tg("format")} summary={`${aspectRatio} · ${resolution}`} icon={<Square className="size-3.5 shrink-0" aria-hidden />}>
            <FormatFields aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} resolution={resolution} onResolutionChange={setResolution} />
          </Section>

          {/* Optional, so it's a chip like the other settings: the bar leads with the product list. */}
          <Section title={tg("instructions")} summary={shorten(instructions)} icon={<PenLine className="size-3.5 shrink-0" aria-hidden />}>
            <label htmlFor="bulk-instructions" className="sr-only">
              {chipLabel(tg("instructions"))}
            </label>
            <Textarea
              id="bulk-instructions"
              value={instructions}
              maxLength={2000}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={tg("instructionsPlaceholder")}
              className="field-sizing-content max-h-40 min-h-16 cursor-text resize-none rounded-xl border border-input bg-muted/40 px-3 py-2.5 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground hover:border-ring/50 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm dark:bg-input/30"
            />
            <PromptChips chips={th.raw("details") as string[]} value={instructions} max={2000} onChange={setInstructions} />
            <PromptTips text={instructions} />
          </Section>

          <StartErrorBox error={error} />
        </PanelBody>

        <PanelFooter
          cost={count * unitCost}
          submitLabel={t("start", { count })}
          canSubmit={canSubmit}
          busy={pending}
          onReset={() => {
            setText("");
            setFileName(null);
            setSubcategory(null);
            setScene(null);
            setStyle(null);
            setAspectRatio("1:1");
            setCatalogImage(1);
            setResolution("HD");
            setInstructions("");
            setError(null);
          }}
        />
      </ConfigPanel>

      <BulkImageCanvas open={runs.open} runs={runs.runs} onShow={runs.show} onChanged={runs.changed} onDeleted={runs.deleted} emptyTitle={t("emptyTitle")} emptyBody={t("emptyBody")} />
    </>
  );
}
