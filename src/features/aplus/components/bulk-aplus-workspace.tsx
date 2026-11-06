"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { ConfigPanel, Field, FormatFields, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { CategoryFields, StyleChips } from "@/features/image-batch/components/bulk-fields";
import { BulkImageCanvas } from "@/features/image-batch/components/bulk-image-canvas";
import { BulkModeTabs } from "@/features/image-batch/components/bulk-mode-tabs";
import { ProductListField, StartErrorBox, useStartError, type StartError } from "@/features/image-batch/components/product-list-field";
import { useImageRuns } from "@/features/image-batch/components/use-image-runs";
import type { AplusLayout } from "@/lib/ai/types";
import { categoryPresets, findCategory } from "@/lib/catalog-presets";
import { IMAGE_BATCH_MAX_ROWS, parseAplusRows } from "@/lib/image-batch/rows";
import type { AspectRatio, Resolution } from "@/lib/image-formats";
import { startAplusBatch } from "../batch-actions";
import { layoutPresets } from "../config";
import { useJobCost } from "@/features/credits/use-job-cost";

const TEMPLATE = {
  name: "imagine-bulk-aplus-template.csv",
  csv: [
    "sku,title,subtitle,feature_1,feature_1_text,feature_2,feature_2_text,feature_3,feature_3_text,feature_4,feature_4_text",
    'SOFA-2041,Oslo Sofa,Deep comfort for every day,Linen,"Breathable, woven linen",Oak legs,Solid oak,,,,',
    "",
  ].join("\n"),
};

/** Bulk A+: an A+ image per CSV row (its own title and features), same layout, scene and format. */
export function BulkAplusWorkspace() {
  const t = useTranslations("AplusBulk");
  const ti = useTranslations("ImageBulk");
  const ta = useTranslations("Aplus");
  const tp = useTranslations("Presets");
  const tw = useTranslations("Workspace");
  const startError = useStartError();
  const runs = useImageRuns("aplus");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [category, setCategory] = useState(categoryPresets[0].key);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [layout, setLayout] = useState<AplusLayout | null>("bento");
  const [scene, setScene] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("HD");
  const [error, setError] = useState<StartError | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(() => parseAplusRows(text), [text]);
  const count = parsed.rows.length;
  const unitCost = useJobCost("aplus");
  const preset = findCategory(category) ?? categoryPresets[0];

  function start() {
    if (!count || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startAplusBatch({
        text,
        name: fileName ?? undefined,
        settings: { category, subcategory, layout, scene, style, aspectRatio, resolution, title: layout ? ta(`layouts.${layout}`) : t("layoutAuto") },
      });
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
      <ConfigPanel onSubmit={start}>
        <PanelHeader title={t("panelTitle")} />

        <PanelBody disabled={pending}>
          <BulkModeTabs tool="/aplus" mode="bulk" />

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
              problems: parsed.skipped.map((p) => ({ key: String(p.row), text: ti("problemRow", { row: p.row, reason: ti(`problems.${p.reason}`) }) })),
            }}
            placeholder={t("pastePlaceholder")}
            hint={t("formatHint", { max: IMAGE_BATCH_MAX_ROWS })}
            template={TEMPLATE}
          />

          <Section title={ta("reference")}>
            <div role="radiogroup" aria-label={ta("reference")} className="flex flex-wrap gap-1.5">
              {[...layoutPresets, null].map((l) => (
                <button
                  key={l ?? "auto"}
                  type="button"
                  role="radio"
                  aria-checked={layout === l}
                  onClick={() => setLayout(l)}
                  className={cn("rounded-full border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground", layout === l && "border-primary bg-primary text-primary-foreground")}
                >
                  {l ? ta(`layouts.${l}`) : t("layoutAuto")}
                </button>
              ))}
            </div>
          </Section>

          <Section title={ta("sceneStyle")}>
            <CategoryFields
              label={ta("category")}
              category={category}
              subcategory={subcategory}
              onCategory={(key) => {
                setCategory(key);
                setSubcategory(null);
                setScene(null);
                setStyle(null);
              }}
              onSubcategory={setSubcategory}
            />
            <Field label={ta("scenes")} gap="gap-1.5">
              <div role="radiogroup" aria-label={ta("scenes")} className="flex flex-wrap gap-2">
                {preset.scenes.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={scene === s.key}
                    onClick={() => setScene(scene === s.key ? null : s.key)}
                    className={cn("flex h-[110px] w-[118px] flex-col overflow-hidden rounded-xl border bg-muted text-start", scene === s.key && "border-2 border-primary")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- tenant-configurable preset images */}
                    <img src={s.image} alt="" className="h-[70px] w-full shrink-0 object-cover" />
                    <span className="w-full truncate p-1.5 text-[11px] font-semibold">{tp(`scenes.${s.key}`)}</span>
                  </button>
                ))}
              </div>
            </Field>
            <StyleChips category={category} value={style} onChange={setStyle} />
          </Section>

          <Section title={ta("output")}>
            <FormatFields aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} resolution={resolution} onResolutionChange={setResolution} />
          </Section>

          <StartErrorBox error={error} />
        </PanelBody>

        <PanelFooter
          cost={count * unitCost}
          submitLabel={t("start", { count })}
          canSubmit={count > 0}
          busy={pending}
          onReset={() => {
            setText("");
            setFileName(null);
            setSubcategory(null);
            setLayout("bento");
            setScene(null);
            setStyle(null);
            setAspectRatio("1:1");
            setResolution("HD");
            setError(null);
          }}
        />
      </ConfigPanel>

      <BulkImageCanvas open={runs.open} runs={runs.runs} onShow={runs.show} onChanged={runs.changed} onDeleted={runs.deleted} emptyTitle={t("emptyTitle")} emptyBody={t("emptyBody")} />
    </>
  );
}
