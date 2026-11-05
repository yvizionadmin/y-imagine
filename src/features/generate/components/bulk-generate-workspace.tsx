"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ConfigPanel, Field, FormatFields, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import { ScenePicker, type SceneChoice } from "@/components/app/scene-picker";
import { Textarea } from "@/components/ui/textarea";
import { CategoryFields, StyleChips } from "@/features/image-batch/components/bulk-fields";
import { BulkImageCanvas } from "@/features/image-batch/components/bulk-image-canvas";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { ProductListField, StartErrorBox, useStartError, type StartError } from "@/features/image-batch/components/product-list-field";
import { useImageRuns } from "@/features/image-batch/components/use-image-runs";
import { categoryPresets, findCategory, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { IMAGE_BATCH_MAX_ROWS, parseImageRows } from "@/lib/image-batch/rows";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { startImageBatch } from "../batch-actions";

const TEMPLATE = { name: "imagine-bulk-images-template.csv", csv: "sku,product_size\nSOFA-2041,220 × 90 × 85 cm\nCHAIR-118,\n" };

const defaultScene = (category: string): SceneChoice => {
  const first = findCategory(category)?.scenes[0];
  return first ? { kind: "preset", key: first.key } : null;
};

/** Bulk Generate: a lifestyle image for every SKU in a list, from its catalog photo, in the background. */
export function BulkGenerateWorkspace() {
  const t = useTranslations("GenerateBulk");
  const ti = useTranslations("ImageBulk");
  const tg = useTranslations("Generate");
  const tp = useTranslations("Presets");
  const th = useTranslations("PromptHints");
  const tw = useTranslations("Workspace");
  const startError = useStartError();
  const runs = useImageRuns("generate");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [category, setCategory] = useState(categoryPresets[0].key);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneChoice>(defaultScene(categoryPresets[0].key));
  const [style, setStyle] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("HD");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<StartError | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(() => parseImageRows(text, PRODUCT_SIZE_MAX), [text]);
  const count = parsed.rows.length;
  const preset = findCategory(category) ?? categoryPresets[0];

  function chooseCategory(key: string) {
    setCategory(key);
    setSubcategory(null);
    // A described scene isn't tied to a category, so it survives the switch.
    setScene((s) => (s?.kind === "custom" ? s : defaultScene(key)));
    setStyle(null);
  }

  // The History title every image gets, in the UI language (same as single Generate).
  const title = [
    scene?.kind === "preset" ? tp(`scenes.${scene.key}`) : scene?.kind === "custom" ? tg("customScene") : subcategory ? tp(`subcategories.${subcategory}`) : tp(`categories.${category}`),
    style ? tp(`styles.${style}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const canSubmit = count > 0 && (scene?.kind !== "custom" || scene.prompt.trim() !== "");

  function start() {
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startImageBatch({
        text,
        name: fileName ?? undefined,
        settings: {
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
      if (!result.ok) {
        const blocked = blockedReason(result.error);
        return setError(startError(result.error, count, blocked ? tw(`blocked.${blocked}.title`) : null));
      }
      runs.started(result.batch);
      setText("");
      setFileName(null);
    });
  }

  return (
    <>
      <ConfigPanel onSubmit={start}>
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

          <Section title={tg("sceneSettings")}>
            <CategoryFields label={tg("category")} category={category} subcategory={subcategory} onCategory={chooseCategory} onSubcategory={setSubcategory} />
            <Field label={tg("scenes")} gap="gap-1.5">
              <ScenePicker label={tg("scenes")} recommended={preset.scenes} value={scene} onChange={setScene} chips={th.raw(`scenes.${category}`) as string[]} allowUpload={false} />
            </Field>
            <StyleChips category={category} value={style} onChange={setStyle} />
          </Section>

          <Section title={tg("format")}>
            <FormatFields aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} resolution={resolution} onResolutionChange={setResolution} />
          </Section>

          <div className="flex flex-col gap-2">
            <label htmlFor="bulk-instructions" className="text-[11px] font-bold text-muted-foreground uppercase">
              {tg("instructions")}
            </label>
            <Textarea
              id="bulk-instructions"
              value={instructions}
              maxLength={2000}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={tg("instructionsPlaceholder")}
              className="h-20 min-h-20 resize-none rounded-lg bg-muted p-3 text-xs leading-[1.4] placeholder:text-subtle md:text-xs"
            />
            <PromptChips chips={th.raw("details") as string[]} value={instructions} max={2000} onChange={setInstructions} />
            <PromptTips text={instructions} />
          </div>

          <StartErrorBox error={error} />
        </PanelBody>

        <PanelFooter
          cost={count}
          submitLabel={t("start", { count })}
          canSubmit={canSubmit}
          busy={pending}
          onReset={() => {
            setText("");
            setFileName(null);
            setSubcategory(null);
            setScene(defaultScene(category));
            setStyle(null);
            setAspectRatio("1:1");
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
