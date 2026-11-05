"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Dropzone, FileCard, ProductDropzone } from "@/components/app/upload-inputs";
import { Input } from "@/components/ui/input";
import type { AplusFeature, AplusLayout } from "@/lib/ai/types";
import { FEATURE_RANGE, layoutPresets, TEXT_LIMITS } from "../config";

const IMAGE_ACCEPT = "image/png,image/jpeg";

export type ProductSource = { kind: "file"; file: File | null } | { kind: "url"; url: string };
export type ReferenceChoice = { kind: "none" } | { kind: "library"; layout: AplusLayout } | { kind: "upload"; file: File };

export function ProductSourceInput({
  value,
  preview,
  onChange,
  onUrlCommit,
}: {
  value: ProductSource;
  preview: string | null;
  onChange: (value: ProductSource) => void;
  /** Called on blur/Enter so the canvas only loads the remote image once the URL is complete. */
  onUrlCommit: (url: string) => void;
}) {
  const t = useTranslations("Aplus");
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
        {(["file", "url"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={value.kind === kind}
            onClick={() => value.kind !== kind && onChange(kind === "file" ? { kind, file: null } : { kind, url: "" })}
            className={cn(
              "rounded py-1.5 text-[11px] font-semibold text-muted-foreground",
              value.kind === kind && "bg-background text-foreground shadow-xs",
            )}
          >
            {t(kind === "file" ? "sourceFile" : "sourceUrl")}
          </button>
        ))}
      </div>
      {value.kind === "file" ? (
        <ProductDropzone
          file={value.file}
          preview={preview}
          onChange={(file) => onChange({ kind: "file", file })}
          title={t("uploadTitle")}
          hint={t("uploadHint")}
          accept={IMAGE_ACCEPT}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Input
            type="url"
            inputMode="url"
            dir="ltr"
            value={value.url}
            onChange={(e) => onChange({ kind: "url", url: e.target.value })}
            onBlur={(e) => onUrlCommit(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onUrlCommit(e.currentTarget.value.trim());
              }
            }}
            placeholder={t("urlPlaceholder")}
            className="h-auto rounded-lg px-3 py-2 text-[13px] placeholder:text-subtle md:text-[13px]"
          />
          <p className="text-[10px] text-subtle">{t("urlHint")}</p>
        </div>
      )}
    </div>
  );
}

/** Wireframe of a reference layout, used as its thumbnail. */
function LayoutThumb({ layout, className }: { layout: AplusLayout; className?: string }) {
  return (
    <div className={cn("flex size-14 shrink-0 flex-col gap-0.5 rounded-md border bg-background p-1", className)} aria-hidden>
      <div className="flex flex-[1.4] gap-0.5">
        <div className="flex-1 rounded-sm bg-primary/25" />
        {layout === "gallery" && (
          <div className="flex w-2.5 flex-col gap-0.5">
            <div className="flex-1 rounded-sm bg-primary/15" />
            <div className="flex-1 rounded-sm bg-primary/15" />
            <div className="flex-1 rounded-sm bg-primary/15" />
          </div>
        )}
      </div>
      <div className="flex flex-1 gap-0.5">
        <div className="flex-1 rounded-sm bg-muted-foreground/20" />
        <div className="flex-1 rounded-sm bg-muted-foreground/20" />
      </div>
    </div>
  );
}

export function ReferencePicker({
  value,
  preview,
  onChange,
}: {
  value: ReferenceChoice;
  preview: string | null;
  onChange: (value: ReferenceChoice) => void;
}) {
  const t = useTranslations("Aplus");
  const [browsing, setBrowsing] = useState(false);

  if (value.kind !== "none") {
    const name = value.kind === "library" ? t(`layouts.${value.layout}`) : value.file.name;
    const meta = value.kind === "library" ? t(`layoutMeta.${value.layout}`) : t("uploadedLayout");
    return (
      <FileCard
        thumb={
          value.kind === "library" ? (
            <LayoutThumb layout={value.layout} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview ?? ""} alt="" className="size-14 shrink-0 rounded-md bg-background object-cover" />
          )
        }
        name={name}
        meta={<span className="font-mono">{meta}</span>}
        actions={
          <button type="button" onClick={() => onChange({ kind: "none" })} className="self-start text-[11px] font-semibold text-primary">
            {t("change")}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={browsing}
          onClick={() => setBrowsing((b) => !b)}
          className="rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted"
        >
          {t("pickLibrary")}
        </button>
        <span className="text-[10px] text-subtle">{t("orUpload")}</span>
      </div>
      {browsing && (
        <div className="grid grid-cols-2 gap-2">
          {layoutPresets.map((layout) => (
            <button
              key={layout}
              type="button"
              onClick={() => {
                setBrowsing(false);
                onChange({ kind: "library", layout });
              }}
              className="flex items-center gap-2 rounded-lg border p-2 text-start hover:border-primary hover:bg-accent"
            >
              <LayoutThumb layout={layout} className="size-10" />
              <span className="text-[11px] leading-tight font-semibold">{t(`layouts.${layout}`)}</span>
            </button>
          ))}
        </div>
      )}
      <Dropzone
        accept={IMAGE_ACCEPT}
        onFile={(file) => onChange({ kind: "upload", file })}
        title={t("referenceUploadTitle")}
        hint={t("referenceUploadHint")}
        className="h-[70px] flex-row gap-3 border-border bg-transparent [&_span]:items-start"
      />
    </div>
  );
}

export function FeatureBlocks({
  value,
  onChange,
}: {
  value: AplusFeature[];
  onChange: (value: AplusFeature[]) => void;
}) {
  const t = useTranslations("Aplus");
  const update = (index: number, patch: Partial<AplusFeature>) =>
    onChange(value.map((feature, i) => (i === index ? { ...feature, ...patch } : feature)));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold text-muted-foreground">
        {t("features", { count: value.length, max: FEATURE_RANGE.max })}
      </span>
      {value.map((feature, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#94a3b8] uppercase">{t("featureLabel", { n: i + 1 })}</span>
            {value.length > FEATURE_RANGE.min && (
              <button
                type="button"
                aria-label={t("removeFeature", { n: i + 1 })}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-subtle hover:text-[#ef4444]"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          <input
            value={feature.title}
            maxLength={TEXT_LIMITS.featureTitle}
            onChange={(e) => update(i, { title: e.target.value })}
            placeholder={t("featureTitlePlaceholder")}
            aria-label={`${t("featureLabel", { n: i + 1 })} – ${t("featureTitlePlaceholder")}`}
            className="bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-subtle"
          />
          <input
            value={feature.description}
            maxLength={TEXT_LIMITS.featureDescription}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder={t("featureDescriptionPlaceholder")}
            aria-label={`${t("featureLabel", { n: i + 1 })} – ${t("featureDescriptionPlaceholder")}`}
            className="bg-transparent text-xs text-muted-foreground outline-none placeholder:text-subtle"
          />
        </div>
      ))}
      {value.length < FEATURE_RANGE.max && (
        <button
          type="button"
          onClick={() => onChange([...value, { title: "", description: "" }])}
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-[11px] font-semibold text-primary hover:bg-accent"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("addFeature")}
        </button>
      )}
    </div>
  );
}
