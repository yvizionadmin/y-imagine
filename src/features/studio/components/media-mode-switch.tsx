"use client";

import { ImageIcon, Lock, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { MEDIA_MODES, type MediaMode } from "../types";

const ICONS = { image: ImageIcon, video: Video } as const;

/** Image | Video switch under the Studio prompt. Video shows a lock on plans without it. */
export function MediaModeSwitch({ mode, onChange, videoLocked }: { mode: MediaMode; onChange: (mode: MediaMode) => void; videoLocked: boolean }) {
  const t = useTranslations("Studio");
  return (
    <div role="radiogroup" aria-label={t("modeLabel")} className="grid w-full max-w-xs grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      {MEDIA_MODES.map((m) => {
        const Icon = ICONS[m];
        const selected = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(m)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold text-muted-foreground outline-offset-2",
              selected && "bg-background text-foreground shadow-sm",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(`modes.${m}`)}
            {m === "video" && videoLocked && <Lock className="size-3.5" aria-label={t("paidOnly")} />}
          </button>
        );
      })}
    </div>
  );
}
