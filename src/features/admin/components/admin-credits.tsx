"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAID_ONLY_FEATURES, parseCreditRules, planHasVideo, PRICED_FEATURES, VIDEO_RESOLUTIONS, videoCost, type CreditRules, type PricedFeature } from "@/lib/credits";
import { LATN } from "@/lib/format";
import { PLAN_IDS, type PlanId } from "@/lib/plans";
import { getAdminCredits, saveAdminCredits } from "../actions";
import { Card, NoticeBar, PageHeader, Table, td, th, type Notice } from "./admin-ui";
import { LoadingSkeleton } from "@/components/ui/skeleton";

/** Number fields are edited as text so a half-typed value doesn't jump; the server validates on save. */
type Draft = {
  planCredits: Record<PlanId, string>;
  featureCosts: Record<PricedFeature, string>;
  video: { base: string; perSecond: string; resolution: Record<(typeof VIDEO_RESOLUTIONS)[number], string> };
  planFeatures: Record<PlanId, PricedFeature[]>;
};

const toDraft = (r: CreditRules): Draft => ({
  planCredits: Object.fromEntries(PLAN_IDS.map((p) => [p, String(r.planCredits[p])])) as Draft["planCredits"],
  featureCosts: Object.fromEntries(PRICED_FEATURES.map((f) => [f, String(r.featureCosts[f])])) as Draft["featureCosts"],
  video: {
    base: String(r.video.base),
    perSecond: String(r.video.perSecond),
    resolution: Object.fromEntries(VIDEO_RESOLUTIONS.map((v) => [v, String(r.video.resolution[v])])) as Draft["video"]["resolution"],
  },
  planFeatures: Object.fromEntries(PLAN_IDS.map((p) => [p, [...r.planFeatures[p]]])) as Draft["planFeatures"],
});

const numberInput = "h-9 w-28 text-[13px] tabular-nums";

/** Super-admin credit settings: plan credits, per-tool job cost, video pricing and tools per plan. */
export function AdminCredits() {
  const t = useTranslations("Admin");
  const tTools = useTranslations("Shell.nav");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [defaults, setDefaults] = useState<CreditRules | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({ updatedAt: null, updatedBy: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    getAdminCredits().then((r) => {
      if (!r.ok) return;
      setDraft(toDraft(r.rules));
      setDefaults(r.defaults);
      setMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    });
  }, []);

  if (!draft) return <LoadingSkeleton variant="list" className="p-4" />;

  const parsed = parseCreditRules(draft);
  const n = (v: number) => format.number(v, LATN);
  const set = (fn: (d: Draft) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const toggleTool = (plan: PlanId, tool: PricedFeature) =>
    set((d) => {
      const list = d.planFeatures[plan];
      d.planFeatures[plan] = list.includes(tool) ? list.filter((x) => x !== tool) : PRICED_FEATURES.filter((f) => f === tool || list.includes(f));
    });

  async function save() {
    if (!parsed) return setNotice({ tone: "error", text: t("credits.invalid") });
    setBusy(true);
    const r = await saveAdminCredits(parsed);
    setBusy(false);
    if (!r.ok) return setNotice({ tone: "error", text: r.error === "invalid_input" ? t("credits.invalid") : t(`errors.${r.error}`) });
    setDraft(toDraft(r.rules));
    setMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    setNotice({ tone: "ok", text: t("credits.saved") });
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6 px-8 py-6">
      <PageHeader
        title={t("credits.title")}
        subtitle={meta.updatedAt ? t("credits.lastChanged", { by: meta.updatedBy ?? "—", when: format.relativeTime(new Date(meta.updatedAt), now) }) : t("credits.subtitle")}
      >
        {defaults && (
          <Button variant="outline" onClick={() => setDraft(toDraft(defaults))} disabled={busy} className="h-10 px-4 text-[13px] font-semibold">
            {t("credits.resetDefaults")}
          </Button>
        )}
        <Button onClick={save} disabled={busy || !parsed} className="h-10 px-4 text-[13px] font-bold">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </PageHeader>

      <NoticeBar notice={notice ?? (parsed ? null : { tone: "error", text: t("credits.invalid") })} />

      <Card title={t("credits.plans")}>
        <p className="-mt-2 text-xs text-muted-foreground">{t("credits.plansHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_IDS.map((p) => (
            <label key={p} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t(`plans.${p}`)}</span>
              <Input
                inputMode="numeric"
                dir="ltr"
                aria-label={t(`plans.${p}`)}
                value={draft.planCredits[p]}
                onChange={(e) => set((d) => void (d.planCredits[p] = e.target.value))}
                className="h-9 text-[13px] tabular-nums"
              />
            </label>
          ))}
        </div>
      </Card>

      <Card title={t("credits.costs")}>
        <p className="-mt-2 text-xs text-muted-foreground">{t("credits.costsHint")}</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRICED_FEATURES.map((f) => (
            <li key={f} className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="text-[13px] font-semibold">{tTools(f)}</span>
              <span className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  dir="ltr"
                  aria-label={tTools(f)}
                  value={draft.featureCosts[f]}
                  onChange={(e) => set((d) => void (d.featureCosts[f] = e.target.value))}
                  className={numberInput}
                />
                <span className="text-[11px] text-muted-foreground">{t("credits.perJob")}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("credits.video")}>
        <p className="-mt-2 text-xs text-muted-foreground">{t("credits.videoHint")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold">{t("credits.base")}</span>
            <Input inputMode="numeric" dir="ltr" value={draft.video.base} onChange={(e) => set((d) => void (d.video.base = e.target.value))} className={numberInput} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold">{t("credits.perSecond")}</span>
            <Input inputMode="numeric" dir="ltr" value={draft.video.perSecond} onChange={(e) => set((d) => void (d.video.perSecond = e.target.value))} className={numberInput} />
          </label>
          {VIDEO_RESOLUTIONS.map((r) => (
            <label key={r} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t("credits.multiplier", { resolution: r })}</span>
              <Input inputMode="decimal" dir="ltr" value={draft.video.resolution[r]} onChange={(e) => set((d) => void (d.video.resolution[r] = e.target.value))} className={numberInput} />
            </label>
          ))}
        </div>
        {parsed && (
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {[
              { seconds: 5, resolution: "720p" as const },
              { seconds: 8, resolution: "1080p" as const },
            ].map((ex) => (
              <li key={`${ex.seconds}-${ex.resolution}`}>{t("credits.example", { seconds: n(ex.seconds), resolution: ex.resolution, credits: n(videoCost(parsed, ex)) })}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("credits.access")}>
        <p className="-mt-2 text-xs text-muted-foreground">{t("credits.accessHint")}</p>
        <Table
          minWidth={560}
          head={
            <tr>
              <th className={th}>{t("credits.tool")}</th>
              {PLAN_IDS.map((p) => (
                <th key={p} className={th}>
                  {t(`plans.${p}`)}
                </th>
              ))}
            </tr>
          }
        >
            {PRICED_FEATURES.map((f) => (
              <tr key={f}>
                <td className={td}>
                  {(PAID_ONLY_FEATURES as readonly string[]).includes(f) ? (
                    <span className="flex flex-col">
                      <span>{tTools(f)}</span>
                      <span className="text-[11px] text-muted-foreground">{t("credits.paidOnly")}</span>
                    </span>
                  ) : (
                    tTools(f)
                  )}
                </td>
                {PLAN_IDS.map((p) => {
                  // Editor sound follows the video editor: never on a plan without video.
                  const locked = (PAID_ONLY_FEATURES as readonly string[]).includes(f) && !planHasVideo(p);
                  return (
                    <td key={p} className={td}>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`${tTools(f)} · ${t(`plans.${p}`)}`}
                          checked={!locked && draft.planFeatures[p].includes(f)}
                          disabled={locked}
                          onChange={() => toggleTool(p, f)}
                        />
                        {locked && <Lock className="size-3.5" aria-hidden />}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className={td}>
                <span className="flex flex-col">
                  <span>{t("credits.videoRow")}</span>
                  <span className="text-[11px] text-muted-foreground">{t("credits.paidOnly")}</span>
                </span>
              </td>
              {PLAN_IDS.map((p) => (
                <td key={p} className={td}>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <input type="checkbox" className="size-4 accent-primary" checked={planHasVideo(p)} disabled aria-label={`${t("credits.videoRow")} · ${t(`plans.${p}`)}`} />
                    {!planHasVideo(p) && <Lock className="size-3.5" aria-hidden />}
                  </span>
                </td>
              ))}
            </tr>
        </Table>
      </Card>
    </div>
  );
}
