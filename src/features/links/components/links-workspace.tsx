"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { connectBitly, createShortLink, disconnectBitly, forgetShortLink, getLinks, refreshClicks, type LinkView } from "../actions";
import { confirmAction } from "@/components/app/confirm";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type State = Awaited<ReturnType<typeof getLinks>>;
type ErrorCode = "forbidden" | "invalid_input" | "not_connected" | "invalid_token" | "rate_limited" | "invalid_url" | "provider_error" | "unreachable";

/** Short links through the org's own Bitly account (rail "Bitly"). */
export function LinksWorkspace() {
  const t = useTranslations("Links");
  const [state, setState] = useState<State | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    getLinks().then(setState);
  }, []);
  const refresh = () => getLinks().then(setState);
  const fail = (error: ErrorCode) => setNotice({ tone: "error", text: t(`errors.${error}`) });

  return (
    <div className="flex w-full flex-col gap-6 overflow-y-auto px-8 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">{t("title")}</h1>
        <p className="max-w-2xl text-[13px] text-muted-foreground">{t("subtitle")}</p>
      </div>

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "rounded-lg bg-muted px-3 py-2 text-xs text-danger" : "rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground"}>
          {notice.text}
        </p>
      )}

      {!state ? (
        <LoadingSkeleton variant="list" className="p-4" />
      ) : !state.connection ? (
        <ConnectCard canManage={state.canManage} demo={state.demo} onConnected={() => { setNotice(null); refresh(); }} onError={fail} />
      ) : (
        <>
          <ConnectionBar
            state={state}
            onDisconnected={() => {
              setNotice(null);
              refresh();
            }}
            onError={fail}
          />
          {state.canCreate && (
            <CreateForm
              onCreated={(link) => {
                setNotice({ tone: "ok", text: t("created", { url: link.shortUrl }) });
                refresh();
              }}
              onError={fail}
            />
          )}
          <LinksTable
            links={state.links}
            canCreate={state.canCreate}
            onRefreshed={(links, failed) => {
              setState({ ...state, links });
              setNotice(failed ? { tone: "error", text: t("refreshPartial", { count: failed, display: String(failed) }) } : null);
            }}
            onChanged={refresh}
            onError={fail}
          />
        </>
      )}
    </div>
  );
}

function ConnectCard({ canManage, demo, onConnected, onError }: { canManage: boolean; demo: boolean; onConnected: () => void; onError: (e: ErrorCode) => void }) {
  const t = useTranslations("Links");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const response = await connectBitly(token);
    setBusy(false);
    if (!response.ok) return onError(response.error);
    setToken("");
    onConnected();
  }

  return (
    <section className="flex max-w-xl flex-col gap-4 rounded-2xl border bg-background p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
          <Link2 className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-bold">{t("connectTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("connectBody")}</p>
        </div>
      </div>
      {!canManage ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("askAdmin")}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="bitly-token" className="text-[11px] font-semibold text-muted-foreground">
            {t("token")}
          </label>
          <Input
            id="bitly-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="h-10 font-mono text-[13px]"
          />
          <a href="https://app.bitly.com/settings/api/" target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-[11px] font-semibold text-primary">
            {t("getToken")}
            <ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden />
          </a>
          {demo && <p className="text-[11px] text-subtle">{t("demoHint")}</p>}
          <Button type="submit" disabled={busy || token.trim().length === 0} className="mt-1 w-fit">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? t("checking") : t("connect")}
          </Button>
        </form>
      )}
    </section>
  );
}

function ConnectionBar({ state, onDisconnected, onError }: { state: State; onDisconnected: () => void; onError: (e: ErrorCode) => void }) {
  const t = useTranslations("Links");
  const connection = state.connection!;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 text-[13px]">
      <Check className="size-4 text-emerald-600" aria-hidden />
      <span className="font-semibold">{t("connectedAs", { login: connection.login })}</span>
      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
        {connection.hint}
      </span>
      {state.canManage && (
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto text-danger hover:text-danger"
          onClick={async () => {
            if (!(await confirmAction(t("disconnectConfirm"), "remove"))) return;
            const response = await disconnectBitly();
            if (response.ok) onDisconnected();
            else onError(response.error);
          }}
        >
          {t("disconnect")}
        </Button>
      )}
    </div>
  );
}

function CreateForm({ onCreated, onError }: { onCreated: (link: LinkView) => void; onError: (e: ErrorCode) => void }) {
  const t = useTranslations("Links");
  const [longUrl, setLongUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const response = await createShortLink({ longUrl, title });
    setBusy(false);
    if (!response.ok) return onError(response.error);
    setLongUrl("");
    setTitle("");
    onCreated(response.link);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
      <h2 className="text-[15px] font-bold">{t("createTitle")}</h2>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="link-url" className="text-[11px] font-semibold text-muted-foreground">
            {t("longUrl")}
          </label>
          <Input id="link-url" type="url" required dir="ltr" value={longUrl} onChange={(e) => setLongUrl(e.target.value)} placeholder="https://www.example.com/products/sofa-12345" className="h-10 text-[13px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="link-title" className="text-[11px] font-semibold text-muted-foreground">
            {t("linkTitle")}
          </label>
          <Input id="link-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} className="h-10 text-[13px]" />
        </div>
        <Button type="submit" disabled={busy || !longUrl.trim()} className="h-10 px-5">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t("shorten")}
        </Button>
      </div>
    </form>
  );
}

function LinksTable({
  links,
  canCreate,
  onRefreshed,
  onChanged,
  onError,
}: {
  links: LinkView[];
  canCreate: boolean;
  onRefreshed: (links: LinkView[], failed: number) => void;
  onChanged: () => void;
  onError: (e: ErrorCode) => void;
}) {
  const t = useTranslations("Links");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(link: LinkView) {
    await navigator.clipboard.writeText(link.shortUrl).catch(() => undefined);
    setCopied(link.id);
    setTimeout(() => setCopied((c) => (c === link.id ? null : c)), 1500);
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">{t("listTitle", { count: links.length, display: format.number(links.length, LATN) })}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || links.length === 0}
          onClick={async () => {
            setRefreshing(true);
            const response = await refreshClicks();
            setRefreshing(false);
            if (response.ok) onRefreshed(response.links, response.failed);
            else onError(response.error);
          }}
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
          {t("refreshClicks")}
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b text-[11px] font-semibold text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="py-2 pe-3 text-start">{t("columns.link")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("columns.destination")}</th>
                <th scope="col" className="px-3 py-2 text-end">{t("columns.clicks")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("columns.created")}</th>
                <th scope="col" className="py-2 ps-3"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-b last:border-b-0">
                  <td className="py-3 pe-3">
                    <div className="flex flex-col gap-0.5">
                      {link.title && <span className="font-semibold">{link.title}</span>}
                      <a href={link.shortUrl} target="_blank" rel="noreferrer" dir="ltr" className="w-fit font-mono text-xs text-primary hover:underline">
                        {link.shortUrl.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                  </td>
                  <td className="max-w-[320px] px-3">
                    <span className="block truncate text-xs text-muted-foreground" dir="ltr" title={link.longUrl}>
                      {link.longUrl}
                    </span>
                  </td>
                  <td className="px-3 text-end font-semibold tabular-nums">{link.clicks === null ? "—" : format.number(link.clicks, LATN)}</td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {t("createdBy", { by: link.createdBy, when: format.relativeTime(new Date(Math.min(Date.parse(link.createdAt), now.getTime())), now) })}
                  </td>
                  <td className="py-3 ps-3">
                    <div className="flex justify-end gap-1">
                      <IconAction label={copied === link.id ? t("copied") : t("copy")} onClick={() => copy(link)}>
                        {copied === link.id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                      </IconAction>
                      <Link
                        href={{ pathname: "/qr", query: { url: link.shortUrl } }}
                        aria-label={t("makeQr")}
                        title={t("makeQr")}
                        className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-primary"
                      >
                        <QrCode className="size-3.5" aria-hidden />
                      </Link>
                      {canCreate && (
                        <IconAction
                          label={t("forget")}
                          onClick={async () => {
                            if (!(await confirmAction(t("forgetConfirm"), "remove"))) return;
                            const response = await forgetShortLink(link.id);
                            if (response.ok) onChanged();
                            else onError(response.error);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </IconAction>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-subtle">{t("clicksNote")}</p>
    </section>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-primary"
    >
      {children}
    </button>
  );
}
