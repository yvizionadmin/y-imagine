"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { blockedReason } from "@/components/app/job-errors";
import { Choice } from "@/features/editor/components/editor-panels";
import { VOICE_STYLES } from "@/lib/ai/types";
import { videoCost, type VideoResolution } from "@/lib/credits";
import { DEFAULT_DIRECTOR_SETTINGS, DIRECTOR_IDEA_MAX, DIRECTOR_MAX_SCENES, DIRECTOR_MIN_SCENES, type DirectorSettings } from "@/lib/director/limits";
import type { DirectorSetup } from "../actions";

const SCENE_COUNTS = Array.from({ length: DIRECTOR_MAX_SCENES - DIRECTOR_MIN_SCENES + 1 }, (_, i) => String(DIRECTOR_MIN_SCENES + i));

/** What a project will cost, part by part (the same sum the server checks). */
export function estimate(pricing: DirectorSetup["pricing"], s: Pick<DirectorSettings, "scenes" | "seconds" | "resolution" | "voiceOver">) {
  const video = videoCost({ video: pricing.video as Parameters<typeof videoCost>[0]["video"] }, { seconds: s.seconds, resolution: s.resolution as VideoResolution });
  const parts = { script: pricing.director, images: s.scenes * pricing.create, videos: s.scenes * video, voice: s.voiceOver ? pricing.voice : 0 };
  return { ...parts, total: parts.script + parts.images + parts.videos + parts.voice };
}

/** The idea and the video's settings, limited to what the org's video model can make. */
export function DirectorForm({ setup, onCreate }: { setup: DirectorSetup; onCreate: (idea: string, settings: DirectorSettings) => Promise<boolean> }) {
  const t = useTranslations("Director");
  const tw = useTranslations("Workspace");
  const options = setup.options;
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<DirectorSettings>(() => ({
    ...DEFAULT_DIRECTOR_SETTINGS,
    aspectRatio: options?.aspectRatios.includes(DEFAULT_DIRECTOR_SETTINGS.aspectRatio) ? DEFAULT_DIRECTOR_SETTINGS.aspectRatio : (options?.aspectRatios[0] ?? "9:16"),
    seconds: options?.durations.includes(DEFAULT_DIRECTOR_SETTINGS.seconds) ? DEFAULT_DIRECTOR_SETTINGS.seconds : (options?.durations[0] ?? 4),
    resolution: options?.resolutions.includes(DEFAULT_DIRECTOR_SETTINGS.resolution) ? DEFAULT_DIRECTOR_SETTINGS.resolution : (options?.resolutions[0] ?? "720p"),
    voiceOver: setup.voiceProblem === null,
  }));
  const set = (patch: Partial<DirectorSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const cost = estimate(setup.pricing, settings);
  const tooDear = cost.total > setup.creditsRemaining;
  const problem = setup.problem ?? (options && !options.startFrame ? "unsupported" : null);
  const blocked = problem ? blockedReason(problem) : null;

  async function submit() {
    if (!idea.trim() || busy || problem || tooDear) return;
    setBusy(true);
    if (await onCreate(idea, settings)) setIdea("");
    setBusy(false);
  }

  return (
    <form
      aria-label={t("form.title")}
      className="flex flex-col gap-4 rounded-2xl border bg-background p-4 md:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold">{t("form.title")}</h2>
        <p className="text-xs text-muted-foreground">{setup.model ? t("form.model", { model: setup.model }) : t("form.body")}</p>
      </div>
      {problem && (
        <p role="note" className="rounded-lg bg-muted px-3 py-2 text-xs">
          {blocked ? tw(`blocked.${blocked}.title`) : t.has(`errors.${problem}`) ? t(`errors.${problem}`) : t("errors.generic")}
        </p>
      )}
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        maxLength={DIRECTOR_IDEA_MAX}
        rows={3}
        dir="auto"
        aria-label={t("form.idea")}
        placeholder={t("form.ideaPlaceholder")}
        className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm"
      />
      {options && (
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <Choice label={t("form.scenes")} value={String(settings.scenes)} options={SCENE_COUNTS} labelFor={(v) => v} onChange={(v) => set({ scenes: Number(v) })} />
          <Choice label={t("form.seconds")} value={String(settings.seconds)} options={options.durations.map(String)} labelFor={(v) => t("form.secondsValue", { n: Number(v) })} onChange={(v) => set({ seconds: Number(v) })} />
          <Choice label={t("form.size")} value={settings.aspectRatio} options={options.aspectRatios} labelFor={(v) => t(`form.ratios.${v.replace(":", "x")}`)} onChange={(aspectRatio) => set({ aspectRatio })} />
          <Choice label={t("form.resolution")} value={settings.resolution} options={options.resolutions} labelFor={(v) => v} onChange={(resolution) => set({ resolution })} />
          <Choice label={t("form.language")} value={settings.language} options={["en", "ar"] as const} labelFor={(v) => t(`form.languages.${v}`)} onChange={(language) => set({ language })} />
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-primary" checked={settings.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />
              {t("form.subtitles")}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-primary" checked={settings.voiceOver} disabled={setup.voiceProblem !== null} onChange={(e) => set({ voiceOver: e.target.checked })} />
              {t("form.voiceOver")}
            </label>
            {setup.voiceProblem && <p className="text-[11px] text-muted-foreground">{t("form.noVoice")}</p>}
          </div>
          {settings.voiceOver && (
            <Choice label={t("form.voice")} value={settings.voice} options={VOICE_STYLES} labelFor={(v) => t(`form.voices.${v}`)} onChange={(voice) => set({ voice })} />
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <div className="flex min-w-0 flex-1 flex-col text-[11px] text-muted-foreground">
          <span className="text-xs font-semibold text-foreground">{t("form.estimate", { count: cost.total })}</span>
          <span>{t("form.breakdown", { script: cost.script, images: cost.images, videos: cost.videos, voice: cost.voice })}</span>
          {tooDear && <span className="text-danger">{t("form.tooDear", { count: setup.creditsRemaining })}</span>}
        </div>
        <Button type="submit" disabled={busy || !idea.trim() || problem !== null || tooDear}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
