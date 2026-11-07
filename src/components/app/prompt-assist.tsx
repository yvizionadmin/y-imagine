"use client";

import { Lightbulb, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { appendPhrase, promptTips, unusedChips } from "@/lib/prompt-hints";

/** Tested phrases under a prompt box; clicking one adds it to the text. Used chips disappear. */
/** Suggested phrases to append; `limit` keeps the row short in the prompt dock. */
export function PromptChips({ chips, value, max, limit, onChange }: { chips: readonly string[]; value: string; max: number; limit?: number; onChange: (value: string) => void }) {
  const t = useTranslations("PromptHints");
  const shown = unusedChips(chips, value)
    .filter((chip) => appendPhrase(value, chip, max) !== null)
    .slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <div role="group" aria-label={t("suggestions")} className="flex flex-wrap gap-1.5">
      {shown.map((chip) => (
        <button
          key={chip}
          type="button"
          aria-label={t("add", { phrase: chip })}
          onClick={() => onChange(appendPhrase(value, chip, max) ?? value)}
          className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="size-3" aria-hidden />
          {chip}
        </button>
      ))}
    </div>
  );
}

/** One-line tips for wording that gives poor results; announced politely to screen readers. */
export function PromptTips({ text, checkShort = false }: { text: string; checkShort?: boolean }) {
  const t = useTranslations("PromptHints.tips");
  const tips = promptTips(text, { checkShort });
  return (
    <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
      {tips.map((tip) => (
        <p key={tip} className="flex items-start gap-1.5 text-[11px] leading-[1.4] text-amber-700">
          <Lightbulb className="mt-px size-3 shrink-0" aria-hidden />
          {t(tip)}
        </p>
      ))}
    </div>
  );
}
