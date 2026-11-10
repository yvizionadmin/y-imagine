"use client";

import { AlertCircle, Check, Clapperboard, Download, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { blockedReason } from "@/components/app/job-errors";
import { Link } from "@/i18n/navigation";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import { DIRECTOR_STEPS, type DirectorView } from "@/lib/director/limits";

const SHOWN_STEPS = DIRECTOR_STEPS.filter((s) => s !== "done");
const RATIO_CLASS = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "16:9": "aspect-video" } as const;
/** The finished video's frame, sized before the file loads (like the editor's preview). */
const PLAYER_CLASS = { "9:16": "aspect-[9/16] h-[min(60vh,560px)]", "1:1": "aspect-square h-[min(60vh,480px)]", "16:9": "aspect-video w-full max-w-3xl" } as const;

/** One Director project: where it is, the scenes as they are made, and the finished video. */
export function DirectorProjectView({ project, canEdit, busy, onRetry, onDelete }: { project: DirectorView; canEdit: boolean; busy: boolean; onRetry: () => void; onDelete: () => void }) {
  const t = useTranslations("Director");
  const tw = useTranslations("Workspace");
  const working = project.status !== "done" && project.status !== "failed";
  const at = project.status === "failed" ? project.failedStep : project.status;
  const reached = (step: (typeof SHOWN_STEPS)[number]) => project.status === "done" || SHOWN_STEPS.indexOf(step) < SHOWN_STEPS.indexOf(at as (typeof SHOWN_STEPS)[number]);
  const blocked = project.error ? blockedReason(project.error) : null;
  const fileName = `${(project.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "video"}.mp4`;

  return (
    <section aria-labelledby="director-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="director-title" dir="auto" className="text-start text-lg font-bold">
            {project.title || t("untitled")}
          </h2>
          {project.settings.character && (
            <p className="text-start text-xs font-medium text-primary">{t("starring", { name: project.settings.character.name })}</p>
          )}
          {project.idea !== project.title && (
            <p dir="auto" className="text-start text-xs text-muted-foreground">
              {project.idea}
            </p>
          )}
        </div>
        {canEdit && !working && (
          <Button type="button" size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
            <Trash2 className="size-3.5" aria-hidden />
            {t("delete")}
          </Button>
        )}
      </div>

      <ol aria-label={t("progress")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SHOWN_STEPS.map((step, i) => {
          const done = reached(step);
          const current = step === at && working;
          const failed = step === at && project.status === "failed";
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs", done && "border-primary/40 bg-accent", current && "border-primary", failed && "border-danger/50 bg-danger/5")}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold", done && "bg-primary text-primary-foreground", failed && "bg-danger text-white")}>
                {done ? <Check className="size-3" aria-hidden /> : failed ? <AlertCircle className="size-3" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1 font-medium">{t(`steps.${step}`)}</span>
              {current && <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {working && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(`working.${project.status as (typeof SHOWN_STEPS)[number]}`)}
        </p>
      )}

      {project.status === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1">
            {t("failed", { step: t(`steps.${project.failedStep ?? "planning"}`) })}{" "}
            {blocked ? tw(`blocked.${blocked}.title`) : t.has(`errors.${project.error}`) ? t(`errors.${project.error}`) : t("errors.generic")}
          </span>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={busy}>
              <RotateCcw className="size-3.5" aria-hidden />
              {t("retry")}
            </Button>
          )}
        </div>
      )}

      {project.output && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-background p-4">
          <h3 className="text-sm font-bold">{t("result")}</h3>
          <video src={project.output.url} controls playsInline preload="metadata" aria-label={t("result")} className={cn("self-center rounded-lg bg-black", PLAYER_CLASS[project.settings.aspectRatio])} />
          <div className="flex flex-wrap gap-2">
            <a href={project.output.url} download={fileName} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              <Download className="size-3.5" aria-hidden />
              {t("download")}
            </a>
            {project.editId && (
              <Link href={{ pathname: "/editor", query: { project: project.editId } }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted">
                <Clapperboard className="size-3.5" aria-hidden />
                {t("openEditor")}
              </Link>
            )}
          </div>
        </div>
      )}

      {project.scenes.length > 0 && (
        <ol aria-label={t("scenes")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {project.scenes.map((scene, i) => (
            <li key={scene.id} aria-label={t("scene", { n: i + 1 })} className="flex flex-col gap-2 rounded-2xl border bg-background p-3">
              <div className={cn("relative mx-auto overflow-hidden rounded-lg bg-muted", RATIO_CLASS[project.settings.aspectRatio], project.settings.aspectRatio === "9:16" ? "h-72" : "w-full")}>
                {scene.videoUrl ? (
                  <video
                    src={scene.videoUrl}
                    // The storyboard frame (with the character, when there is one) until it plays.
                    poster={scene.imageUrl ? thumbnailUrl(scene.imageUrl, 640) : undefined}
                    controls
                    playsInline
                    preload="none"
                    aria-label={t("sceneVideo", { n: i + 1 })}
                    className="size-full object-cover"
                  />
                ) : scene.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- our asset route, thumbnailed
                  <img src={thumbnailUrl(scene.imageUrl, 640)} alt={t("sceneImage", { n: i + 1 })} className="size-full object-cover" />
                ) : (
                  <div className="size-full animate-pulse" aria-hidden />
                )}
                <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">{t("sceneShort", { n: i + 1 })}</span>
              </div>
              <p dir="auto" className="text-start text-sm">
                {scene.narration}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {(scene.videoStatus === "pending" || scene.videoStatus === "running") && <Loader2 className="size-3 animate-spin" aria-hidden />}
                {scene.error ? <span className="text-danger">{t("sceneFailed")}</span> : t(`sceneStatus.${scene.imageUrl || scene.videoStatus !== "waiting" ? scene.videoStatus : "noImage"}`)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
