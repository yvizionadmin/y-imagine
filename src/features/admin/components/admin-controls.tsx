"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { JOB_FEATURES, type JobFeature } from "@/features/analytics/config";
import { LATN } from "@/lib/format";
import { PLAN_IDS, type PlanId } from "@/lib/plans";
import { getAdminControls, saveAdminControls } from "../actions";
import { Card, NoticeBar, PageHeader, selectClass, type Notice } from "./admin-ui";
import { usePlanCredits } from "./use-plan-credits";
import { confirmAction } from "@/components/app/confirm";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type Form = { maintenance: { enabled: boolean; message: string }; signupsEnabled: boolean; defaultPlan: PlanId; disabledFeatures: string[] };

/** Platform switches: maintenance mode, open sign-ups, default plan, and per-tool kill switches. */
export function AdminControls() {
  const t = useTranslations("Admin");
  const tTools = useTranslations("Analytics.tools");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [form, setForm] = useState<Form | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({ updatedAt: null, updatedBy: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const planCredits = usePlanCredits();

  useEffect(() => {
    getAdminControls().then((r) => {
      if (!r.ok) return;
      const { updatedAt, updatedBy, creditRules: _rules, ...rest } = r.settings;
      void _rules;
      setForm(rest);
      setMeta({ updatedAt, updatedBy });
    });
  }, []);

  if (!form) return <LoadingSkeleton variant="list" className="p-4" />;

  const patch = (next: Partial<Form>) => setForm({ ...form, ...next });
  const toggleFeature = (f: JobFeature) =>
    patch({ disabledFeatures: form.disabledFeatures.includes(f) ? form.disabledFeatures.filter((x) => x !== f) : [...form.disabledFeatures, f] });

  async function save() {
    if (form!.maintenance.enabled && !(await confirmAction(t("controls.maintenanceConfirm"), "continue"))) return;
    setBusy(true);
    const r = await saveAdminControls(form!);
    setBusy(false);
    if (!r.ok) return setNotice({ tone: "error", text: t(`errors.${r.error}`) });
    setMeta({ updatedAt: r.settings.updatedAt, updatedBy: r.settings.updatedBy });
    setNotice({ tone: "ok", text: t("controls.saved") });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6 px-8 py-6">
      <PageHeader
        title={t("controls.title")}
        subtitle={meta.updatedAt ? t("controls.lastChanged", { by: meta.updatedBy ?? "—", when: format.relativeTime(new Date(meta.updatedAt), now) }) : t("controls.subtitle")}
      >
        <Button onClick={save} disabled={busy} className="h-10 px-4 text-[13px] font-bold">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </PageHeader>

      <NoticeBar notice={notice} />

      <Card title={t("controls.maintenance")}>
        <Toggle
          id="maintenance"
          checked={form.maintenance.enabled}
          onChange={(enabled) => patch({ maintenance: { ...form.maintenance, enabled } })}
          label={t("controls.maintenanceLabel")}
          hint={t("controls.maintenanceHint")}
          danger
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="maintenance-message" className="text-xs font-semibold">
            {t("controls.maintenanceMessage")}
          </label>
          <Textarea
            id="maintenance-message"
            maxLength={280}
            rows={2}
            value={form.maintenance.message}
            onChange={(e) => patch({ maintenance: { ...form.maintenance, message: e.target.value } })}
            placeholder={t("controls.maintenancePlaceholder")}
            className="text-[13px]"
          />
        </div>
      </Card>

      <Card title={t("controls.signups")}>
        <Toggle
          id="signups"
          checked={form.signupsEnabled}
          onChange={(signupsEnabled) => patch({ signupsEnabled })}
          label={t("controls.signupsLabel")}
          hint={t("controls.signupsHint")}
        />
        <div className="flex max-w-sm flex-col gap-1.5">
          <label htmlFor="default-plan" className="text-xs font-semibold">
            {t("controls.defaultPlan")}
          </label>
          <select id="default-plan" value={form.defaultPlan} onChange={(e) => patch({ defaultPlan: e.target.value as PlanId })} className={selectClass}>
            {PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {t(`plans.${p}`)} · {t("creditsPerMonth", { display: format.number(planCredits[p], LATN) })}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card title={t("controls.features")}>
        <p className="-mt-2 text-xs text-muted-foreground">{t("controls.featuresHint")}</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {JOB_FEATURES.map((f) => (
            <li key={f}>
              <Toggle
                id={`feature-${f}`}
                checked={!form.disabledFeatures.includes(f)}
                onChange={() => toggleFeature(f)}
                label={tTools(f)}
                hint={form.disabledFeatures.includes(f) ? t("controls.featureOff") : t("controls.featureOn")}
                bordered
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
  danger,
  bordered,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  danger?: boolean;
  bordered?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", bordered && "rounded-xl border p-3")}>
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full bg-muted transition-colors outline-offset-2",
          checked && (danger ? "bg-destructive" : "bg-primary"),
        )}
      >
        <span className={cn("absolute top-0.5 start-0.5 size-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5 rtl:-translate-x-5")} />
      </button>
    </div>
  );
}
