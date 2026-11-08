"use client";

import { isBlocked, type BlockedReason } from "@/components/app/job-errors";
import { useState, type ReactNode } from "react";
import {
  Download,
  Image as ImageIcon,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Wand,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  CanvasEmptyState,
  CanvasShell,
  CompareSlider,
  ImageBadge,
  ImageFrame,
  StatusPill,
} from "@/components/app/workspace-canvas";
import type { GeneratedImage } from "@/lib/ai/types";
import type { CameraAngle } from "@/lib/camera-angles";

export type CanvasState =
  | { kind: "empty" }
  | { kind: "preview"; src: string }
  | { kind: "generating"; src: string | null }
  | { kind: "result"; image: GeneratedImage; source: string | null }
  | { kind: "failed"; reason: "generation" | "input" | BlockedReason };

export type ShotThumb = { angle: CameraAngle; status: "pending" | "done" | "failed"; src: string | null };

export function GenerateCanvas({
  sku,
  state,
  shots,
  activeShot,
  onSelectShot,
  onRegenerate,
  onEditDetails,
  onExport,
  empty,
}: {
  /** The product, so an upscaled copy is filed with it in History. */
  sku: string;
  /** Replaces the default "will appear here" state (the start screen's example cards). */
  empty?: ReactNode;
  state: CanvasState;
  shots: ShotThumb[];
  activeShot: number;
  onSelectShot: (index: number) => void;
  onRegenerate: () => void;
  onEditDetails: () => void;
  onExport: () => void;
}) {
  const t = useTranslations("Generate");
  const tw = useTranslations("Workspace");
  const [comparing, setComparing] = useState(false);
  const showCompare = comparing && state.kind === "result" && state.source !== null;

  const top =
    state.kind === "generating" ? (
      <StatusPill dot="bg-amber-500">{t("processing")}</StatusPill>
    ) : state.kind === "result" ? (
      <div className="flex items-center gap-1 rounded-xl border bg-background p-1 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
        <ToolbarButton
          pressed={showCompare}
          disabled={state.source === null}
          onClick={() => setComparing((c) => !c)}
          icon={<ImageIcon className="size-4" aria-hidden />}
        >
          {t("beforeAfter")}
        </ToolbarButton>
        <Divider />
        <ToolbarButton onClick={onRegenerate} icon={<RefreshCw className="size-4" aria-hidden />}>
          {t("regenerate")}
        </ToolbarButton>
        <Divider />
        <ToolbarButton onClick={onEditDetails} icon={<SlidersHorizontal className="size-4" aria-hidden />}>
          {t("editDetails")}
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={onExport}
          icon={<Download className="size-4" aria-hidden />}
          className="bg-accent text-primary hover:bg-accent/80"
        >
          {t("export")}
        </ToolbarButton>
      </div>
    ) : null;

  return (
    <CanvasShell top={top} bottom={shots.length > 1 && <ShotStrip shots={shots} active={activeShot} onSelect={onSelectShot} />} source={{ sku, mode: "lifestyle" }}>
      {state.kind === "empty" && empty}
      {state.kind === "empty" && !empty && (
        <CanvasEmptyState
          icon={<Wand className="size-8" strokeWidth={1.5} aria-hidden />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      )}

      {state.kind === "preview" && (
        <ImageFrame>
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={state.src} alt="" className="block max-h-[480px] max-w-[640px]" />
        </ImageFrame>
      )}

      {state.kind === "generating" && (
        <ImageFrame className="bg-[#1f2937]">
          {state.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={state.src} alt="" className="block max-h-[480px] max-w-[640px] opacity-40" />
          ) : (
            <div className="h-[420px] w-[560px]" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#111827]/80 text-center text-white" role="status">
            <div className="relative flex size-14 items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-dashed border-primary [animation-duration:3s]" />
              <span className="absolute inset-2 animate-spin rounded-full border-2 border-dashed border-emerald-400 [animation-direction:reverse] [animation-duration:2s]" />
              <Sparkles className="absolute -end-4 -top-1 size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[15px] font-bold">{t("creatingTitle")}</p>
              <p className="text-xs text-white/70">{t("creatingBody")}</p>
            </div>
          </div>
        </ImageFrame>
      )}

      {state.kind === "result" && !showCompare && (
        <ImageFrame>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider output URL */}
          <img data-result="" src={state.image.url} alt={t("aiGenerated")} className="block max-h-[480px] max-w-[640px]" />
          <ImageBadge className="absolute start-3 top-3">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("aiGenerated")}
          </ImageBadge>
        </ImageFrame>
      )}

      {showCompare && state.kind === "result" && state.source && (
        <CompareSlider
          before={state.source}
          after={state.image.url}
          beforeBadge={<ImageBadge>{t("original")}</ImageBadge>}
          afterBadge={<ImageBadge>{t("generatedLabel")}</ImageBadge>}
        />
      )}

      {state.kind === "failed" && (
        <div className="flex w-[480px] max-w-full flex-col items-center gap-4 rounded-2xl border bg-background p-8 text-center shadow-[0_8px_24px_rgba(0,0,0,0.06)]" role="alert">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-[#ef4444]">
            <TriangleAlert className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{isBlocked(state.reason) ? tw(`blocked.${state.reason}.title`) : t("failedTitle")}</h2>
            <p className="text-[13px] leading-normal text-muted-foreground">
              {isBlocked(state.reason) ? tw(`blocked.${state.reason}.body`) : state.reason === "input" ? t("invalidInputBody") : t("failedBody")}
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

function ShotStrip({ shots, active, onSelect }: { shots: ShotThumb[]; active: number; onSelect: (index: number) => void }) {
  const t = useTranslations("Generate.shots");
  return (
    <div role="tablist" aria-label={t("shotsLabel")} className="flex gap-2 rounded-xl border bg-background p-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
      {shots.map((shot, index) => (
        <button
          key={index}
          type="button"
          role="tab"
          aria-selected={index === active}
          title={t(`angleNames.${shot.angle}`)}
          onClick={() => onSelect(index)}
          className={cn(
            "flex w-16 flex-col items-center gap-1 rounded-lg p-1 text-[10px] font-medium text-muted-foreground hover:bg-muted",
            index === active && "bg-accent text-primary hover:bg-accent",
          )}
        >
          <span className="relative flex size-14 items-center justify-center overflow-hidden rounded-md bg-muted">
            {shot.status === "done" && shot.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider output URL
              <img src={shot.src} alt="" className="size-full object-cover" />
            ) : shot.status === "failed" ? (
              <TriangleAlert className="size-4 text-[#ef4444]" aria-hidden />
            ) : (
              <span className="size-5 animate-spin rounded-full border-2 border-dashed border-primary [animation-duration:3s]" />
            )}
          </span>
          <span className="truncate" dir="ltr">
            {t(`angles.${shot.angle}`)}
          </span>
        </button>
      ))}
    </div>
  );
}

function ToolbarButton({
  icon,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  icon: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50",
        pressed && "bg-accent text-primary",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-border" />;
}
