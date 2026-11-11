"use client";

import { Lightbulb, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { useLocalFlag } from "@/lib/local-flag";
import { GUIDED_PAGES, guideFlag, type GuideKey } from "@/lib/tool-guides";


/**
 * The first time someone opens a tool (U6): a small card with how it works in three steps. "Got it" hides it for
 * good in this browser. Nothing else on the page changes.
 */
export function ToolGuide() {
  const pathname = usePathname();
  const key = (GUIDED_PAGES as Record<string, GuideKey>)[pathname] ?? null;
  return key ? <Guide key={key} guide={key} /> : null;
}

function Guide({ guide }: { guide: GuideKey }) {
  const t = useTranslations("Shell.guides");
  const [seen, markSeen] = useLocalFlag(guideFlag(guide));
  if (seen) return null;
  return (
    <aside
      aria-labelledby={`guide-${guide}`}
      className="fixed end-4 top-[calc(var(--spacing-topbar,5rem)+1rem)] z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl border bg-popover p-4 font-sans text-popover-foreground shadow-lg max-md:top-auto max-md:bottom-4"
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <h2 id={`guide-${guide}`} className="flex-1 text-sm font-bold">
          {t(`${guide}.title`)}
        </h2>
        <button type="button" onClick={markSeen} aria-label={t("close")} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <ol className="flex flex-col gap-2">
        {(["s1", "s2", "s3"] as const).map((step, i) => (
          <li key={step} className="flex gap-2.5 text-xs leading-relaxed">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>
            <span>{t(`${guide}.${step}`)}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={markSeen} className="self-end rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
        {t("gotIt")}
      </button>
    </aside>
  );
}
