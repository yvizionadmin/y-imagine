"use client";

import { Lightbulb, Plus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { listTeamPhrases } from "@/features/prompts/actions";
import type { PromptTool } from "@/lib/ai/types";
import { appendPhrase, promptTips, unusedChips } from "@/lib/prompt-hints";

/** Team chips shown at most, ahead of the standard ones. */
const TEAM_SHOWN = 2;
const ARABIC = /[\u0600-\u06FF]/;

/** The org's own phrases for a tool and category (see listTeamPhrases); empty until loaded or on failure. */
export function useTeamPhrases(tool: PromptTool, category: string) {
  const [phrases, setPhrases] = useState<{ key: string; list: string[] }>({ key: "", list: [] });
  const key = `${tool}:${category}`;
  useEffect(() => {
    let live = true;
    listTeamPhrases({ tool, category })
      .then((list) => live && setPhrases({ key, list }))
      .catch(() => live && setPhrases({ key, list: [] }));
    return () => {
      live = false;
    };
  }, [tool, category, key]);
  return phrases.key === key ? phrases.list : [];
}

/**
 * Suggested phrases to append; clicking one adds it to the text and used chips disappear. `team`
 * phrases (the org's own, in the page's language) come first with a team icon; `limit` keeps the
 * row short in the prompt dock.
 */
export function PromptChips({ chips, team = [], value, max, limit, onChange }: { chips: readonly string[]; team?: readonly string[]; value: string; max: number; limit?: number; onChange: (value: string) => void }) {
  const t = useTranslations("PromptHints");
  const arabic = useLocale() === "ar";
  const fits = (list: readonly string[]) => unusedChips(list, value).filter((chip) => appendPhrase(value, chip, max) !== null);
  const standard = new Set(chips.map((chip) => chip.toLowerCase()));
  const teamShown = fits(team)
    .filter((phrase) => ARABIC.test(phrase) === arabic && !standard.has(phrase.toLowerCase()))
    .slice(0, TEAM_SHOWN);
  const shown = [...teamShown.map((phrase) => ({ phrase, team: true })), ...fits(chips).map((phrase) => ({ phrase, team: false }))].slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <div role="group" aria-label={t("suggestions")} className="flex flex-wrap gap-1.5">
      {shown.map(({ phrase, team: fromTeam }) => (
        <button
          key={phrase}
          type="button"
          aria-label={t(fromTeam ? "addTeam" : "add", { phrase })}
          title={fromTeam ? t("teamHint") : undefined}
          onClick={() => onChange(appendPhrase(value, phrase, max) ?? value)}
          className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
        >
          {fromTeam ? <Users className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
          {phrase}
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
