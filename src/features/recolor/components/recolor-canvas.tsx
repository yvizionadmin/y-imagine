"use client";

import { isBlocked, type BlockedReason } from "@/components/app/job-errors";
import { useState, type ReactNode } from "react";
import { CircleCheck, Palette, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CategoryPreset } from "@/lib/catalog-presets";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CanvasEmptyState, CanvasShell, CompareSlider, ImageFrame } from "@/components/app/workspace-canvas";
import type { GeneratedImage, PreservationCheck } from "@/lib/ai/types";

export type RecolorCanvasState =
  | { kind: "empty" }
  | { kind: "preview"; src: string }
  | { kind: "generating"; src: string | null }
  | { kind: "result"; image: GeneratedImage; source: string | null; preserved: PreservationCheck[] }
  | { kind: "failed"; reason: "generation" | "input" | BlockedReason };

type View = "original" | "split" | "recolored";

const IMAGE_BOX = "block max-h-[460px] max-w-[720px]";

export function RecolorCanvas({
  kind,
  state,
  onCancel,
  onRegenerate,
  onEditNotes,
  onDownload,
  onUseImage,
  used,
}: {
  /** The category's recolor wording (fabric, finish, product, device, garment). */
  kind: CategoryPreset["recolorKind"];
  state: RecolorCanvasState;
  onCancel: () => void;
  onRegenerate: () => void;
  onEditNotes: () => void;
  onDownload: () => void;
  onUseImage: () => void;
  used: boolean;
}) {
  const t = useTranslations("Recolor");
  const tw = useTranslations("Workspace");
  const tk = (key: string) => t(`kinds.${kind}.${key}`);
  const [view, setView] = useState<View>("recolored");
  const hasResult = state.kind === "result";
  const activeView: View = hasResult && state.source ? view : "recolored";

  const top = hasResult && state.source && (
    <div role="radiogroup" aria-label={t("views")} className="flex gap-0.5 rounded-lg border bg-muted p-1">
      {(["original", "split", "recolored"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={activeView === key}
          onClick={() => setView(key)}
          className={cn(
            "rounded-md px-3.5 py-1 text-xs font-medium text-muted-foreground",
            activeView === key && "bg-background font-semibold text-foreground shadow-xs",
          )}
        >
          {t(key === "original" ? "viewOriginal" : key === "split" ? "viewSplit" : "viewRecolored")}
        </button>
      ))}
    </div>
  );

  return (
    <CanvasShell top={top}>
      {state.kind === "empty" && (
        <CanvasEmptyState
          icon={<Palette className="size-8" strokeWidth={1.5} aria-hidden />}
          title={tk("emptyTitle")}
          body={tk("emptyBody")}
        />
      )}

      {state.kind === "preview" && (
        <ImageFrame>
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={state.src} alt="" className={IMAGE_BOX} />
          <Tag className="absolute start-3 top-3 bg-[#374151]">{t("originalBadge")}</Tag>
        </ImageFrame>
      )}

      {state.kind === "generating" && (
        <ImageFrame className="border-0 bg-[#1f2937]">
          {state.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={state.src} alt="" className={cn(IMAGE_BOX, "opacity-30 grayscale")} />
          ) : (
            <div className="h-[420px] w-[640px]" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#111827]/70 text-center text-white" role="status">
            <div className="relative flex size-14 items-center justify-center rounded-full bg-white/5">
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[#ec4899] border-r-[#ec4899]" />
              <span className="size-3.5 rounded-full bg-white shadow-[0_0_12px_4px_rgba(236,72,153,0.6)]" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[15px] font-bold">{tk("creatingTitle")}</p>
              <p className="text-xs text-white/70">{t("creatingBody")}</p>
            </div>
            <button type="button" onClick={onCancel} className="text-xs font-semibold text-[#ec4899] underline underline-offset-4">
              {t("cancel")}
            </button>
          </div>
        </ImageFrame>
      )}

      {state.kind === "result" && activeView === "original" && state.source && (
        <ImageFrame>
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={state.source} alt={t("originalBadge")} className={IMAGE_BOX} />
          <Tag className="absolute start-3 top-3 bg-[#374151]">{t("originalBadge")}</Tag>
        </ImageFrame>
      )}

      {state.kind === "result" && activeView === "split" && state.source && (
        <CompareSlider
          before={state.source}
          after={state.image.url}
          className="h-[460px] w-[720px]"
          beforeBadge={<Tag className="bg-[#374151]">{t("originalBadge")}</Tag>}
          afterBadge={<Tag className="bg-[#8b5cf6]">{t("recoloredBadge")}</Tag>}
        />
      )}

      {state.kind === "result" && activeView === "recolored" && (
        <ImageFrame className="border-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- provider output URL */}
          <img data-result="" src={state.image.url} alt={t("aiRecolored")} className={IMAGE_BOX} />
          <span className="absolute start-4 top-4 flex items-center gap-1.5 rounded-md border border-[#2563eb]/25 bg-[#0b1020]/90 px-3 py-1.5 text-[11px] font-bold text-white uppercase">
            <Sparkles className="size-3 text-[#a5b4fc]" aria-hidden />
            {t("aiRecolored")}
          </span>
          {/* Only checks a vision model confirmed; hidden when the check couldn't run. */}
          {state.preserved.length > 0 && (
            <div className="absolute start-4 bottom-4 flex w-[220px] flex-col gap-3 rounded-[10px] border border-[#2a2a32] bg-[#18181c]/90 p-4 shadow-[0_8px_16px_rgba(0,0,0,0.25)]">
              <p className="text-[11px] font-bold text-subtle uppercase">{t("preservation")}</p>
              <ul className="flex flex-col gap-2">
                {state.preserved.map((check) => (
                  <li key={check} className="flex items-center gap-2 text-xs font-medium text-[#f3f4f6]">
                    <CircleCheck className="size-3.5 text-emerald-500" aria-hidden />
                    {check === "stitching" ? tk("detailsCheck") : t(`checks.${check}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ImageFrame>
      )}

      {state.kind === "result" && (
        <div className="flex items-center gap-4 rounded-xl border border-[#2a2a32] bg-[#18181c] p-3 shadow-[0_6px_9px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-2">
            <DarkButton
              onClick={() => setView((v) => (v === "split" ? "recolored" : "split"))}
              disabled={!state.source}
              pressed={activeView === "split"}
              className="px-4 font-semibold"
            >
              {t("compare")}
            </DarkButton>
            <DarkButton onClick={onRegenerate}>{t("regenerate")}</DarkButton>
            <DarkButton onClick={onEditNotes}>{t("editNotes")}</DarkButton>
            <DarkButton onClick={onDownload}>{t("download")}</DarkButton>
          </div>
          <span className="h-5 w-px bg-[#2a2a32]" />
          <button
            type="button"
            onClick={onUseImage}
            disabled={used}
            className="rounded-md bg-primary px-5 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {used ? t("usedImage") : t("useImage")}
          </button>
        </div>
      )}

      {state.kind === "failed" && (
        <div className="flex w-[480px] max-w-full flex-col items-center gap-4 rounded-2xl border bg-background p-8 text-center shadow-[0_8px_24px_rgba(0,0,0,0.06)]" role="alert">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-[#ef4444]">
            <TriangleAlert className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{isBlocked(state.reason) ? tw(`blocked.${state.reason}.title`) : t("failedTitle")}</h2>
            <p className="text-[13px] leading-normal text-muted-foreground">
              {isBlocked(state.reason) ? tw(`blocked.${state.reason}.body`) : state.reason === "input" ? tk("invalidInputBody") : tk("failedBody")}
            </p>
          </div>
          <div className="flex gap-3">
            {state.reason === "generation" && (
              <Button onClick={onRegenerate} className="h-9 px-4 text-[13px] font-semibold">
                <RefreshCw aria-hidden />
                {tw("tryAgain")}
              </Button>
            )}
            <Button variant="outline" onClick={onEditNotes} className="h-9 px-4 text-[13px] font-semibold">
              {tw("changeSettings")}
            </Button>
          </div>
        </div>
      )}
    </CanvasShell>
  );
}

function Tag({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white", className)}>
      {children}
    </span>
  );
}

function DarkButton({
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
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
        "rounded-md border border-[#2a2a32] bg-[#1f1f24] px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-[#f3f4f6] hover:bg-[#2a2a32] disabled:opacity-50",
        pressed && "border-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}
