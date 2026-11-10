"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clapperboard, Loader2, Lock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PageHeader } from "@/components/app/page-header";
import { blockedReason } from "@/components/app/job-errors";
import { Link } from "@/i18n/navigation";
import type { DirectorSettings, DirectorSummary, DirectorView } from "@/lib/director/limits";
import { createDirectorProject, deleteDirectorProject, getDirectorProject, getDirectorSetup, listDirectorProjects, retryDirectorProject, type DirectorSetup } from "../actions";
import { DirectorForm } from "./director-form";
import { DirectorProjectView } from "./director-project";

const POLL_MS = 4000;
const working = (status: string) => status !== "done" && status !== "failed";

/** AI Director (under the video editor): start a video from an idea, follow it, and see past ones. */
export function DirectorWorkspace() {
  const t = useTranslations("Director");
  const tw = useTranslations("Workspace");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [setup, setSetup] = useState<DirectorSetup | null>(null);
  const [projects, setProjects] = useState<DirectorSummary[] | null>(null);
  const [project, setProject] = useState<DirectorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getDirectorSetup(), listDirectorProjects()]).then(([s, list]) => {
      setSetup(s);
      setProjects(list);
    });
    const id = searchParams.get("project");
    if (id) void getDirectorProject(id).then(setProject);
    // Only on load: later changes to ?project= come from this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follows a project while it works.
  const id = project?.id;
  const active = project ? working(project.status) : false;
  useEffect(() => {
    if (!id || !active) return;
    const timer = setInterval(async () => {
      const next = await getDirectorProject(id);
      if (!next) return;
      setProject(next);
      if (!working(next.status)) {
        setProjects((list) => (list ?? []).map((p) => (p.id === next.id ? { ...p, status: next.status, title: next.title } : p)));
        router.refresh(); // the credit badge
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, active, router]);

  function show(next: DirectorView | null) {
    setProject(next);
    setError(null);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("project", next.id);
    else url.searchParams.delete("project");
    window.history.replaceState(null, "", url);
  }

  async function create(idea: string, settings: DirectorSettings, characterId: string | null) {
    setError(null);
    const result = await createDirectorProject({ idea, settings, characterId });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setProjects((list) => [{ id: result.project.id, title: result.project.title, idea: result.project.idea, status: result.project.status, updatedAt: result.project.updatedAt }, ...(list ?? [])]);
    show(result.project);
    return true;
  }

  async function retry() {
    if (!project) return;
    setBusy(true);
    const result = await retryDirectorProject(project.id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setProject(result.project);
  }

  async function remove() {
    if (!project || !window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    const result = await deleteDirectorProject(project.id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setProjects((list) => (list ?? []).filter((p) => p.id !== project.id));
    show(null);
  }

  if (!setup || projects === null) return <Loader2 className="mx-auto mt-24 size-6 animate-spin text-muted-foreground" aria-label={t("loading")} />;
  const canEdit = setup.canEdit && setup.allowed;
  const blocked = error ? blockedReason(error) : null;

  return (
    // The app shell doesn't scroll; this page scrolls itself.
    <div className="w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Link href="/editor" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted">
              <Clapperboard className="size-3.5" aria-hidden />
              {t("editor")}
            </Link>
          }
        />

        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {blocked ? tw(`blocked.${blocked}.title`) : t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
          </p>
        )}

        {!setup.allowed ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-background px-6 py-12 text-center">
            <Lock className="size-6 text-muted-foreground" aria-hidden />
            <p className="max-w-md text-sm">{t("locked")}</p>
            <Link href="/settings/billing" className="text-sm font-medium text-primary hover:underline">
              {t("upgrade")}
            </Link>
          </div>
        ) : project ? (
          <>
            <button type="button" onClick={() => show(null)} className="flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
              {t("back")}
            </button>
            <DirectorProjectView project={project} canEdit={canEdit} busy={busy} onRetry={() => void retry()} onDelete={() => void remove()} />
          </>
        ) : (
          <>
            {canEdit ? <DirectorForm setup={setup} onCreate={create} /> : <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}
            <section aria-labelledby="director-list" className="flex flex-col gap-2">
              <h2 id="director-list" className="text-sm font-bold">
                {t("recent")}
              </h2>
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("none")}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => void getDirectorProject(p.id).then(show)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-xl border bg-background px-3 py-2.5 text-start hover:border-primary"
                      >
                        <span dir="auto" className="w-full truncate text-start text-sm font-medium">
                          {p.title || p.idea}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {t(`status.${p.status}`)} · {format.relativeTime(new Date(p.updatedAt))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
