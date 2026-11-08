"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Check, Loader2, MessageSquare, PanelLeft, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { blockedReason, isBlocked } from "@/components/app/job-errors";
import { useJobCost } from "@/features/credits/use-job-cost";
import { CHAT_MESSAGE_MAX } from "@/lib/chat/limits";
import type { ChatMessage, ChatThread } from "@/lib/chat/threads";
import type { ChatEvent } from "@/lib/chat/turn";
import { deleteChatThread, getChatState, openChatThread, renameChatThread } from "../actions";

type Shown = Pick<ChatMessage, "id" | "role" | "content" | "status"> & { pending?: boolean };
/** A failed send: a blocked reason (Workspace.blocked.*), or Chat.errors.*. */
type Failure = { reason: string };

const SUGGESTIONS = ["description", "titles", "campaign", "arabic"] as const;

/** The assistant (rail "Chat"): the user's threads on the start side, the open conversation on the other. */
export function ChatWorkspace() {
  const t = useTranslations("Chat");
  const tw = useTranslations("Workspace");
  const router = useRouter();
  const searchParams = useSearchParams();
  const cost = useJobCost("chat");

  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [canSend, setCanSend] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Shown[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    getChatState().then((state) => {
      setThreads(state.threads);
      setCanSend(state.canSend);
    });
    const id = searchParams.get("thread");
    if (id) open(id);
    // Only on load: later changes to ?thread= come from this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the reply as it is written, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function setUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("thread", id);
    else url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);
  }

  async function open(id: string) {
    if (streaming) return;
    setListOpen(false);
    setFailure(null);
    setActive(id);
    setLoadingThread(true);
    const result = await openChatThread(id);
    setLoadingThread(false);
    if (!result) {
      setActive(null);
      setMessages([]);
      setUrl(null);
      return;
    }
    atBottom.current = true;
    setMessages(result.messages);
    setUrl(id);
  }

  function startNew() {
    if (streaming) return;
    setListOpen(false);
    setActive(null);
    setMessages([]);
    setFailure(null);
    setUrl(null);
    inputRef.current?.focus();
  }

  async function send(value = text) {
    const message = value.trim();
    if (!message || streaming || !canSend || message.length > CHAT_MESSAGE_MAX) return;
    setFailure(null);
    setText("");
    atBottom.current = true;
    const localUser = `local-user-${Date.now()}`;
    const localReply = `local-reply-${Date.now()}`;
    setMessages((m) => [...m, { id: localUser, role: "user", content: message, status: "ok" }, { id: localReply, role: "assistant", content: "", status: "ok", pending: true }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    let ended: "done" | "error" | "stopped" | null = null;
    // A thread this message started; the server removes it again when the reply fails.
    let started: string | null = null;

    // Takes back the exchange the server didn't keep: the text returns to the box.
    const takeBack = () => {
      setMessages((m) => m.filter((x) => x.id !== localUser && x.id !== localReply));
      setText((current) => current || message);
      if (started) {
        const id = started;
        setThreads((list) => (list ?? []).filter((x) => x.id !== id));
        setActive(null);
        setUrl(null);
      }
    };
    const undo = (reason: string) => {
      takeBack();
      setFailure({ reason });
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message, threadId: active }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        ended = "error";
        undo(error === "forbidden" ? "forbidden" : error === "invalid_input" ? "input" : "failed");
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
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "thread") {
            const thread = event.thread;
            if (!active) started = thread.id;
            setActive(thread.id);
            setUrl(thread.id);
            setThreads((list) => [{ ...thread, updatedAt: event.message.createdAt }, ...(list ?? []).filter((x) => x.id !== thread.id)]);
          } else if (event.type === "delta") {
            reply += event.text;
            setMessages((m) => m.map((x) => (x.id === localReply ? { ...x, content: reply } : x)));
          } else if (event.type === "done") {
            ended = "done";
            setMessages((m) => m.map((x) => (x.id === localReply ? { ...event.message } : x)));
          } else if (event.type === "error") {
            ended = "error";
            if (event.code === "not_found") {
              // The thread was deleted elsewhere: start over in a new one.
              setActive(null);
              setUrl(null);
              setThreads((list) => (list ?? []).filter((x) => x.id !== active));
            }
            undo(event.code === "not_found" ? "notFound" : (blockedReason(event.code) ?? (event.code === "rate_limited" ? "rateLimited" : "failed")));
          }
        }
      }
    } catch {
      if (controller.signal.aborted) ended = "stopped";
      else if (!ended) {
        ended = "error";
        undo("failed");
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      if (ended === "stopped") {
        // The server keeps what was written; nothing written means nothing was kept.
        if (reply.trim()) setMessages((m) => m.map((x) => (x.id === localReply ? { ...x, pending: false, status: "stopped" } : x)));
        else takeBack();
      } else if (!ended) {
        // The connection closed without an outcome.
        undo("failed");
      }
      if (ended === "done" || ended === "stopped") router.refresh(); // the credit badge
    }
  }

  async function remove(id: string) {
    if (streaming) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    const result = await deleteChatThread(id);
    if (!result.ok) return;
    setThreads((list) => (list ?? []).filter((x) => x.id !== id));
    if (active === id) startNew();
  }

  async function rename(id: string, title: string) {
    const result = await renameChatThread(id, title);
    if (result.ok) setThreads((list) => (list ?? []).map((x) => (x.id === id ? result.thread : x)));
  }

  const activeThread = threads?.find((x) => x.id === active) ?? null;

  return (
    <div className="relative flex min-h-0 w-full">
      {listOpen && <button type="button" aria-label={t("closeList")} className="absolute inset-0 z-20 bg-black/20 md:hidden" onClick={() => setListOpen(false)} />}
      <aside
        aria-label={t("threads")}
        className={cn(
          "absolute inset-y-0 start-0 z-30 w-72 max-w-[85%] flex-col gap-2 border-e bg-background p-3 md:static md:flex md:w-64",
          listOpen ? "flex" : "hidden",
        )}
      >
        <Button variant="outline" className="w-full justify-start" onClick={startNew} disabled={streaming}>
          <Plus aria-hidden />
          {t("newChat")}
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads === null ? (
            <Loader2 className="mx-auto mt-6 size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : threads.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">{t("noThreads")}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} active={thread.id === active} disabled={streaming} onOpen={() => open(thread.id)} onDelete={() => remove(thread.id)} onRename={(title) => rename(thread.id, title)} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("threads")} onClick={() => setListOpen(true)}>
            <PanelLeft className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <h1 dir="auto" className="min-w-0 flex-1 truncate text-start text-[15px] font-bold">
            {activeThread?.title ?? t("title")}
          </h1>
          <Button variant="ghost" size="sm" className="md:hidden" onClick={startNew} disabled={streaming}>
            <Plus aria-hidden />
            {t("newChat")}
          </Button>
        </header>

        <div
          ref={scrollRef}
          data-testid="chat-messages"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {loadingThread ? (
              <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" aria-hidden />
            ) : messages.length === 0 ? (
              <EmptyState canSend={canSend} onPick={(prompt) => send(prompt)} />
            ) : (
              messages.map((m) => <Bubble key={m.id} message={m} />)
            )}
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {failure && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                <div className="flex-1">
                  <p className="font-semibold text-danger">{isBlocked(failure.reason) ? tw(`blocked.${failure.reason}.title`) : t(`errors.${failure.reason}.title`)}</p>
                  <p className="text-muted-foreground">{isBlocked(failure.reason) ? tw(`blocked.${failure.reason}.body`) : t(`errors.${failure.reason}.body`)}</p>
                </div>
                <button type="button" aria-label={t("dismiss")} onClick={() => setFailure(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
            {canSend ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:border-ring"
              >
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  maxLength={CHAT_MESSAGE_MAX}
                  aria-label={t("placeholder")}
                  placeholder={t("placeholder")}
                  className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                {streaming ? (
                  <Button type="button" size="icon-lg" variant="outline" className="rounded-full" aria-label={t("stop")} title={t("stop")} onClick={() => abortRef.current?.abort()}>
                    <Square className="size-3.5 fill-current" aria-hidden />
                  </Button>
                ) : (
                  <Button type="submit" size="icon-lg" className="rounded-full" aria-label={t("send")} title={t("send")} disabled={!text.trim()}>
                    <ArrowUp aria-hidden />
                  </Button>
                )}
              </form>
            ) : (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("viewerHint")}</p>
            )}
            {canSend && <p className="text-center text-[11px] text-muted-foreground">{t("costHint", { count: cost })}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ThreadRow({ thread, active, disabled, onOpen, onDelete, onRename }: { thread: ChatThread; active: boolean; disabled: boolean; onOpen: () => void; onDelete: () => void; onRename: (title: string) => void }) {
  const t = useTranslations("Chat");
  const format = useFormatter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);

  if (editing) {
    return (
      <li>
        <form
          className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) onRename(title);
            setEditing(false);
          }}
        >
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("renameLabel")} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          <button type="submit" aria-label={t("save")} className="text-muted-foreground hover:text-foreground">
            <Check className="size-3.5" aria-hidden />
          </button>
        </form>
      </li>
    );
  }
  return (
    <li className={cn("group flex items-center rounded-lg", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}>
      <button type="button" onClick={onOpen} disabled={disabled} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-col items-start px-2.5 py-2 text-start">
        {/* dir="auto": an English title in the Arabic list (or the reverse) is cut at its own end. */}
        <span dir="auto" className="w-full truncate text-start text-[13px] font-medium">
          {thread.title}
        </span>
        <span className="text-[11px] text-muted-foreground">{format.relativeTime(new Date(thread.updatedAt))}</span>
      </button>
      <div className="flex shrink-0 gap-0.5 pe-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        <button type="button" disabled={disabled} aria-label={t("rename", { title: thread.title })} onClick={() => (setTitle(thread.title), setEditing(true))} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button type="button" disabled={disabled} aria-label={t("delete", { title: thread.title })} onClick={onDelete} className="rounded p-1 text-muted-foreground hover:text-danger">
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

function Bubble({ message }: { message: Shown }) {
  const t = useTranslations("Chat");
  const mine = message.role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        dir="auto"
        data-role={message.role}
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
          mine ? "bg-primary text-primary-foreground" : "border bg-background",
        )}
      >
        {message.pending && !message.content ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("thinking")}
          </span>
        ) : (
          message.content
        )}
        {message.status === "stopped" && <span className="mt-1 block text-[11px] text-muted-foreground">{t("stopped")}</span>}
      </div>
    </div>
  );
}

function EmptyState({ canSend, onPick }: { canSend: boolean; onPick: (prompt: string) => void }) {
  const t = useTranslations("Chat");
  return (
    <div className="mt-10 flex flex-col items-center gap-5 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <MessageSquare className="size-6" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-extrabold">{t("emptyTitle")}</h2>
        <p className="max-w-md text-[13px] text-muted-foreground">{t("emptyBody")}</p>
      </div>
      {canSend && (
        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
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
