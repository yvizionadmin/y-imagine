"use client";

import { isBlocked, type BlockedReason } from "@/components/app/job-errors";
import type { ReactNode } from "react";
import { RefreshCw, Sparkles, TriangleAlert, Wand } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CanvasEmptyState, CanvasShell, CompareSlider, ImageBadge, ImageFrame, JobProgress, StatusPill } from "@/components/app/workspace-canvas";
import type { AplusFeature, AplusLayout, GeneratedImage } from "@/lib/ai/types";

export type AplusDraft = {
  product: string | null;
  scene: string | null;
  layout: AplusLayout;
  title: string;
  subtitle: string;
  features: AplusFeature[];
  aspectRatio: string;
};

export type AplusCanvasState =
  | { kind: "empty" }
  | { kind: "preview"; draft: AplusDraft }
  | { kind: "generating"; draft: AplusDraft }
  | { kind: "result"; image: GeneratedImage; source: string | null }
  | { kind: "failed"; reason: "generation" | "input" | "url" | BlockedReason };

const CARD_WIDTH = 480;

export function AplusCanvas({
  sku,
  state,
  comparing,
  onToggleCompare,
  onCancel,
  onRegenerate,
  onEditDetails,
  onExport,
  onDownload,
}: {
  /** The product, so an upscaled copy is filed with it in History. */
  sku: string;
  state: AplusCanvasState;
  comparing: boolean;
  onToggleCompare: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onEditDetails: () => void;
  onExport: () => void;
  onDownload: () => void;
}) {
  const t = useTranslations("Aplus");
  const tw = useTranslations("Workspace");
  const showCompare = comparing && state.kind === "result" && state.source !== null;

  const top =
    state.kind === "preview" ? (
      <StatusPill dot="bg-primary">{t("layoutPreview")}</StatusPill>
    ) : state.kind === "generating" ? (
      <StatusPill dot="bg-amber-500">{t("processing")}</StatusPill>
    ) : state.kind === "result" ? (
      <StatusPill dot="bg-emerald-500">{showCompare ? t("splitActive") : t("generated")}</StatusPill>
    ) : null;

  const bottom = state.kind === "result" && (
    <div className="flex items-center gap-3 rounded-full border bg-background px-4 py-2 shadow-[0_4px_6px_rgba(0,0,0,0.05)]">
      <button
        type="button"
        aria-pressed={showCompare}
        disabled={!state.source}
        onClick={onToggleCompare}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50",
          showCompare && "bg-accent text-primary hover:bg-accent",
        )}
      >
        {t("beforeAfter")}
      </button>
      <span className="h-4 w-px bg-border" />
      <ToolbarLink onClick={onRegenerate}>{t("regenerate")}</ToolbarLink>
      <ToolbarLink onClick={onEditDetails}>{t("editDetails")}</ToolbarLink>
      <ToolbarLink onClick={onExport}>{t("export")}</ToolbarLink>
      <button type="button" onClick={onDownload} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
        {t("download")}
      </button>
    </div>
  );

  return (
    <CanvasShell top={top} bottom={bottom} source={{ sku, mode: "aplus" }}>
      {state.kind === "empty" && (
        <CanvasEmptyState icon={<Wand className="size-8" strokeWidth={1.5} aria-hidden />} title={t("emptyTitle")} body={t("emptyBody")} />
      )}

      {state.kind === "preview" && <LayoutPreview draft={state.draft} />}

      {state.kind === "generating" && (
        <div className="relative">
          <LayoutPreview draft={state.draft} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl bg-[#111827]/85 text-center text-white" role="status">
            <div className="relative flex size-14 items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-dashed border-primary [animation-duration:3s]" />
              <span className="absolute inset-2 animate-spin rounded-full border-2 border-dashed border-emerald-400 [animation-direction:reverse] [animation-duration:2s]" />
              <Sparkles className="absolute -end-4 -top-1 size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1 px-6">
              <p className="text-[15px] font-bold">{t("creatingTitle")}</p>
              <p className="text-xs text-white/70">{t("creatingBody")}</p>
            </div>
            <JobProgress />
            <button type="button" onClick={onCancel} className="text-xs font-semibold underline underline-offset-4">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {state.kind === "result" && !showCompare && (
        <ImageFrame>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider output URL */}
          <img data-result="" src={state.image.url} alt={t("generated")} className="block max-h-[560px] max-w-[640px]" />
        </ImageFrame>
      )}

      {showCompare && state.kind === "result" && state.source && (
        <CompareSlider
          before={state.source}
          after={state.image.url}
          className="h-[480px] w-[640px]"
          beforeBadge={<ImageBadge>{t("original")}</ImageBadge>}
          afterBadge={<ImageBadge>{t("generatedLabel")}</ImageBadge>}
        />
      )}

      {state.kind === "failed" && (
        <div className="flex w-[480px] max-w-full flex-col items-center gap-4 rounded-2xl border bg-background p-8 text-center shadow-[0_8px_24px_rgba(0,0,0,0.06)]" role="alert">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-danger">
            <TriangleAlert className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{isBlocked(state.reason) ? tw(`blocked.${state.reason}.title`) : t("failedTitle")}</h2>
            <p className="text-[13px] leading-normal text-muted-foreground">
              {isBlocked(state.reason) ? tw(`blocked.${state.reason}.body`) : state.reason === "input" ? t("invalidInputBody") : state.reason === "url" ? t("invalidUrlBody") : t("failedBody")}
            </p>
          </div>
          <div className="flex gap-3">
            {state.reason === "generation" && (
              <Button onClick={onRegenerate} className="h-9 px-4 text-[13px] font-semibold">
                <RefreshCw aria-hidden />
                {tw("tryAgain")}
              </Button>
            )}
            <Button variant="outline" onClick={onEditDetails} className="h-9 px-4 text-[13px] font-semibold">
              {tw("changeSettings")}
            </Button>
          </div>
        </div>
      )}
    </CanvasShell>
  );
}

function ToolbarLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}

/** Live HTML replica of the A+ card (Figma 98:4379) so merchants see the layout before generating. */
function LayoutPreview({ draft }: { draft: AplusDraft }) {
  const t = useTranslations("Aplus");
  const [w, h] = draft.aspectRatio.split(":").map(Number);
  const height = Math.round((CARD_WIDTH * h) / w);
  const gallery = draft.layout === "gallery";

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
      style={{ width: CARD_WIDTH, height }}
    >
      <div className={cn("flex shrink-0 gap-3", gallery && "p-3 pb-0")} style={{ height: height * (280 / 480) }}>
        <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-accent to-canvas p-5" style={gallery ? { borderRadius: 4 } : undefined}>
          {draft.scene && (
            // eslint-disable-next-line @next/next/no-img-element -- preset scene
            <img src={draft.scene} alt="" className="absolute inset-0 size-full object-cover" />
          )}
          {draft.product && (
            // eslint-disable-next-line @next/next/no-img-element -- local preview; multiply blends a white studio background
            <img src={draft.product} alt="" className="absolute bottom-[5%] left-1/2 max-h-[72%] max-w-[55%] -translate-x-1/2 object-contain mix-blend-multiply" />
          )}
          <div className="relative flex max-w-full flex-col gap-1 self-start rounded-lg bg-white/80 p-2" style={{ width: "fit-content" }}>
            <p className={cn("text-lg leading-tight font-bold text-[#0f172a]", !draft.title && "border border-dashed border-primary/40 text-subtle")}>
              {draft.title || t("titleArea")}
            </p>
            {draft.subtitle && <p className="text-xs text-[#475569]">{draft.subtitle}</p>}
          </div>
        </div>
        {gallery && (
          <div className="flex w-[84px] flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex-1 overflow-hidden rounded-sm bg-muted">
                {draft.scene && (
                  // eslint-disable-next-line @next/next/no-img-element -- preset scene
                  <img src={draft.scene} alt="" className="size-full object-cover" style={{ objectPosition: `${i * 50}% ${30 + i * 20}%` }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={cn("flex min-h-0 flex-1 border-t", gallery && "mt-3")}>
        {draft.features.map((feature, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col gap-1 border-e p-4 last:border-e-0">
            <p className="truncate text-[11px] font-bold text-primary uppercase">{feature.title || t("featureLabel", { n: i + 1 })}</p>
            <p className="line-clamp-3 text-[13px] font-semibold text-[#0f172a]">{feature.description || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
