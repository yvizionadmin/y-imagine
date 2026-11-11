"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Bot, Loader2, PanelLeft, Plus, Square, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { blockedReason, isBlocked } from "@/components/app/job-errors";
import { useJobCost } from "@/features/credits/use-job-cost";
import { AGENT_GOAL_MAX, appendText, type AgentRun, type AgentRunSummary, type AgentStep, type AgentStreamEvent } from "@/lib/agent/limits";
import { deleteAgentRun, getAgentState, openAgentRun } from "../actions";
import { AgentSteps } from "./agent-steps";
import { confirmAction } from "@/components/app/confirm";
import { LoadingSkeleton } from "@/components/ui/skeleton";

const SUGGESTIONS = ["copyAndImage", "arabic", "image"] as const;

/** Why a run (or starting one) failed: a blocked reason (Workspace.blocked.*), or Agents.errors.*. */
function failureReason(code: string) {
  return blockedReason(code) ?? (code === "rate_limited" ? "rateLimited" : code === "forbidden" ? "forbidden" : code === "invalid_input" ? "input" : code === "timed_out" ? "timedOut" : "failed");
}

/** Agents (rail "Agents"): the user's runs on the start side, the open run and the goal box on the other. */
export function AgentWorkspace() {
  const t = useTranslations("Agents");
  const tw = useTranslations("Workspace");
  const router = useRouter();
  const searchParams = useSearchParams();
  const runCost = useJobCost("agent");
  const copyCost = useJobCost("copy");
  const imageCost = useJobCost("generate");

  const [runs, setRuns] = useState<AgentRunSummary[] | null>(null);
  const [canRun, setCanRun] = useState(true);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [goal, setGoal] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    getAgentState().then((state) => {
      setRuns(state.runs);
      setCanRun(state.canRun);
    });
    const id = searchParams.get("run");
    if (id) open(id);
    // Only on load: later changes to ?run= come from this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the run as it works, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [run]);

  function setUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("run", id);
    else url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  }

  async function open(id: string) {
    if (working) return;
    setListOpen(false);
    setFailure(null);
    setLoadingRun(true);
    const opened = await openAgentRun(id);
    setLoadingRun(false);
    atBottom.current = true;
    setRun(opened);
    setUrl(opened ? id : null);
  }

  function startNew() {
    if (working) return;
    setListOpen(false);
    setRun(null);
    setFailure(null);
    setUrl(null);
    inputRef.current?.focus();
  }

  const updateSteps = (change: (steps: AgentStep[]) => AgentStep[]) => setRun((r) => (r ? { ...r, steps: change(r.steps) } : r));
  const listStatus = (id: string, status: AgentRun["status"]) => setRuns((list) => (list ?? []).map((x) => (x.id === id ? { ...x, status } : x)));

  async function start(value = goal) {
    const text = value.trim();
    if (!text || working || !canRun || text.length > AGENT_GOAL_MAX) return;
    setFailure(null);
    setGoal("");
    atBottom.current = true;
    setRun({ id: "", goal: text, status: "running", steps: [], error: null, createdAt: new Date().toISOString(), finishedAt: null });
    setWorking(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let started: string | null = null;
    let ended = false;

    // Nothing was kept: the goal goes back in the box.
    const takeBack = (code: string) => {
      if (started) {
        const id = started;
        setRuns((list) => (list ?? []).filter((x) => x.id !== id));
      }
      setRun(null);
      setUrl(null);
      setGoal((current) => current || text);
      setFailure(failureReason(code));
    };

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        ended = true;
        takeBack(error ?? "failed");
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentStreamEvent;
          if (event.type === "run") {
            started = event.run.id;
            setRun(event.run);
            setUrl(event.run.id);
            setRuns((list) => [{ id: event.run.id, goal: event.run.goal, status: "running", createdAt: event.run.createdAt }, ...(list ?? [])]);
          } else if (event.type === "text") {
            updateSteps((steps) =>
              steps.some((s) => s.id === event.stepId)
                ? steps.map((s) => (s.id === event.stepId && s.kind === "text" ? { ...s, text: s.text + event.text } : s))
                : appendText(steps, event.text, () => event.stepId).steps,
            );
          } else if (event.type === "step") {
            updateSteps((steps) => (steps.some((s) => s.id === event.step.id) ? steps.map((s) => (s.id === event.step.id ? event.step : s)) : [...steps, event.step]));
          } else if (event.type === "done") {
            ended = true;
            setRun(event.run);
            listStatus(event.run.id, event.run.status);
          } else if (event.type === "error") {
            ended = true;
            takeBack(event.code);
          }
        }
      }
    } catch {
      if (!controller.signal.aborted && !ended) {
        ended = true;
        takeBack("failed");
      }
    } finally {
      abortRef.current = null;
      setWorking(false);
      if (controller.signal.aborted && !ended) {
        // The server keeps what was done; a run that hadn't started anything is dropped there too.
        if (started) {
          const id = started;
          setRun((r) => (r ? { ...r, status: "stopped", steps: r.steps.map((s) => (s.kind === "tool" && s.status === "running" ? { ...s, status: "failed", error: "stopped" } : s)) } : r));
          listStatus(id, "stopped");
        } else {
          setRun(null);
          setGoal((current) => current || text);
        }
      } else if (!ended) {
        takeBack("failed");
      }
      router.refresh(); // the credit badge
    }
  }

  async function remove(id: string) {
    if (working || !(await confirmAction(t("deleteConfirm")))) return;
    const result = await deleteAgentRun(id);
    if (!result.ok) return;
    setRuns((list) => (list ?? []).filter((x) => x.id !== id));
    if (run?.id === id) startNew();
  }

  const runFailure = run && run.status === "failed" ? failureReason(run.error ?? "failed") : null;

  return (
    <div className="relative flex min-h-0 w-full">
      {listOpen && <button type="button" aria-label={t("closeList")} className="absolute inset-0 z-20 bg-black/20 md:hidden" onClick={() => setListOpen(false)} />}
      <aside
        aria-label={t("runs")}
        className={cn("absolute inset-y-0 start-0 z-30 w-72 max-w-[85%] flex-col gap-2 border-e bg-background p-3 md:static md:flex md:w-64", listOpen ? "flex" : "hidden")}
      >
        <Button variant="outline" className="w-full justify-start" onClick={startNew} disabled={working}>
          <Plus aria-hidden />
          {t("newRun")}
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {runs === null ? (
            <Loader2 className="mx-auto mt-6 size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : runs.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">{t("noRuns")}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {runs.map((item) => (
                <RunRow key={item.id} run={item} active={item.id === run?.id} disabled={working} canDelete={canRun} onOpen={() => open(item.id)} onDelete={() => remove(item.id)} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("runs")} onClick={() => setListOpen(true)}>
            <PanelLeft className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-start text-[15px] font-bold">{t("title")}</h1>
          <Button variant="ghost" size="sm" className="md:hidden" onClick={startNew} disabled={working}>
            <Plus aria-hidden />
            {t("newRun")}
          </Button>
        </header>

        <div
          ref={scrollRef}
          data-testid="agent-run"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {loadingRun ? (
              <LoadingSkeleton variant="list" className="p-4" />
            ) : !run ? (
              <EmptyState canRun={canRun} onPick={(prompt) => start(prompt)} />
            ) : (
              <>
                <div className="flex justify-end">
                  <p dir="auto" className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground [overflow-wrap:anywhere]">
                    {run.goal}
                  </p>
                </div>
                {run.steps.length === 0 && working ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t("starting")}
                  </p>
                ) : (
                  <AgentSteps steps={run.steps} working={working} />
                )}
                {run.status === "stopped" && <p className="text-[11px] text-muted-foreground">{t("stopped")}</p>}
                {runFailure && (
                  <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-xs text-danger">
                    {isBlocked(runFailure) ? tw(`blocked.${runFailure}.title`) : t(`errors.${runFailure}.title`)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {failure && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                <div className="flex-1">
                  <p className="font-semibold text-danger">{isBlocked(failure) ? tw(`blocked.${failure}.title`) : t(`errors.${failure}.title`)}</p>
                  <p className="text-muted-foreground">{isBlocked(failure) ? tw(`blocked.${failure}.body`) : t(`errors.${failure}.body`)}</p>
                </div>
                <button type="button" aria-label={t("dismiss")} onClick={() => setFailure(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
            {canRun ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  start();
                }}
                className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:border-ring"
              >
                <textarea
                  ref={inputRef}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      start();
                    }
                  }}
                  rows={1}
                  maxLength={AGENT_GOAL_MAX}
                  aria-label={t("placeholder")}
                  placeholder={t("placeholder")}
                  className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                {working ? (
                  <Button type="button" size="icon-lg" variant="outline" className="rounded-full" aria-label={t("stop")} title={t("stop")} onClick={() => abortRef.current?.abort()}>
                    <Square className="size-3.5 fill-current" aria-hidden />
                  </Button>
                ) : (
                  <Button type="submit" size="icon-lg" className="rounded-full" aria-label={t("run")} title={t("run")} disabled={!goal.trim()}>
                    <ArrowUp aria-hidden />
                  </Button>
                )}
              </form>
            ) : (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("viewerHint")}</p>
            )}
            {canRun && <p className="text-center text-[11px] text-muted-foreground">{t("costHint", { run: runCost, copy: copyCost, image: imageCost })}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function RunRow({ run, active, disabled, canDelete, onOpen, onDelete }: { run: AgentRunSummary; active: boolean; disabled: boolean; canDelete: boolean; onOpen: () => void; onDelete: () => void }) {
  const t = useTranslations("Agents");
  const format = useFormatter();
  return (
    <li className={cn("group flex items-center rounded-lg", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}>
      <button type="button" onClick={onOpen} disabled={disabled} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-col items-start px-2.5 py-2 text-start">
        <span dir="auto" className="w-full truncate text-start text-[13px] font-medium">
          {run.goal}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t(`status.${run.status}`)} · {format.relativeTime(new Date(run.createdAt))}
        </span>
      </button>
      {canDelete && run.status !== "running" && (
        <div className="flex shrink-0 pe-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
          <button type="button" disabled={disabled} aria-label={t("delete", { goal: run.goal.slice(0, 40) })} onClick={onDelete} className="rounded p-1 text-muted-foreground hover:text-danger">
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}

function EmptyState({ canRun, onPick }: { canRun: boolean; onPick: (prompt: string) => void }) {
  const t = useTranslations("Agents");
  return (
    <div className="mt-10 flex flex-col items-center gap-5 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Bot className="size-6" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-extrabold">{t("emptyTitle")}</h2>
        <p className="max-w-md text-[13px] text-muted-foreground">{t("emptyBody")}</p>
      </div>
      {canRun && (
        <div className="grid w-full max-w-xl gap-2">
          {SUGGESTIONS.map((key) => (
            <button key={key} type="button" onClick={() => onPick(t(`suggestions.${key}`))} className="rounded-xl border bg-background px-4 py-3 text-start text-[13px] hover:border-primary hover:text-primary">
              {t(`suggestions.${key}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
