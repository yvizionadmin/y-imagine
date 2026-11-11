"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LATN } from "@/lib/format";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";
import { choosePlan, getBilling, openBillingPortal, resumePlan, type BillingView } from "../actions";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type Interval = "month" | "year";
type Pending = { plan: PlanId; kind: "downgrade" | "change" } | null;
type ActionError = "forbidden" | "invalid_input" | "not_configured" | "billing_failed";

/** Settings → Billing. No Figma frame; follows the light settings pages (API Keys, Integrations). */
export function BillingSettings() {
  const t = useTranslations("Billing");
  const format = useFormatter();
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await getBilling();
    setBilling(next);
    if (next.interval) setInterval(next.interval);
    return next;
  }, []);

  useEffect(() => {
    let stop = false;
    (async () => {
      const first = await load();
      // Back from Checkout: the webhook usually lands within seconds; poll briefly until it does.
      if (checkout !== "success" || first.hasSubscription) return;
      for (let i = 0; i < 6 && !stop; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if ((await load()).hasSubscription) return;
      }
    })();
    return () => {
      stop = true;
    };
  }, [checkout, load]);

  async function run(key: string, action: () => Promise<{ ok: true; url?: string } | { ok: false; error: ActionError }>) {
    setBusy(key);
    setError(null);
    const response = await action();
    if (!response.ok) {
      setBusy(null);
      return setError(t(`errors.${response.error}`));
    }
    if (response.url) return window.location.assign(response.url);
    setPending(null);
    await load();
    setBusy(null);
  }

  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", ...LATN }) : "");
  const money = (amount: number, currency: string) =>
    format.number(amount / 100, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: amount % 100 ? 2 : 0, ...LATN });

  if (!billing) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-10">
        <Header />
        <LoadingSkeleton variant="list" className="p-4" />
      </div>
    );
  }

  const actionable = billing.enabled && billing.canManage;
  const hasYearly = Object.values(billing.prices).some((p) => p?.year !== undefined);
  const used = billing.creditsMonthly - billing.creditsRemaining;
  const seats = PLANS[billing.plan].seats;
  const statusLine =
    billing.status === "trialing"
      ? t("trialEnds", { date: date(billing.periodEnd) })
      : billing.cancelAtPeriodEnd
        ? t("ends", { date: date(billing.periodEnd) })
        : billing.hasSubscription && billing.periodEnd
          ? t("renews", { date: date(billing.periodEnd) })
          : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-10">
      <Header />

      {checkout === "success" && <Notice tone="ok">{billing.hasSubscription ? t("checkoutSuccess") : t("checkoutProcessing")}</Notice>}
      {checkout === "canceled" && <Notice tone="muted">{t("checkoutCanceled")}</Notice>}
      {!billing.enabled && <Notice tone="muted">{t("notConfigured")}</Notice>}
      {billing.enabled && !billing.canManage && <Notice tone="muted">{t("readOnly")}</Notice>}
      {billing.status === "past_due" && (
        <Notice tone="warn" action={actionable && billing.hasCustomer ? { label: t("updatePayment"), busy: busy === "portal", onClick: () => run("portal", openBillingPortal) } : undefined}>
          {t("pastDue")}
        </Notice>
      )}
      {billing.hasSubscription && billing.cancelAtPeriodEnd && (
        <Notice tone="warn" action={actionable ? { label: t("resume"), busy: busy === "resume", onClick: () => run("resume", resumePlan) } : undefined}>
          {t("cancelPending", { date: date(billing.periodEnd) })}
        </Notice>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <section className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border bg-background p-6">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">{t("currentPlan")}</p>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">{t(`plans.${billing.plan}.name`)}</h3>
            {billing.status && billing.status !== "canceled" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  billing.status === "active" || billing.status === "trialing" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                )}
              >
                {t(`status.${billing.status}`)}
              </span>
            )}
            {billing.hasSubscription && billing.interval && <span className="text-xs text-muted-foreground">{t(billing.interval === "year" ? "yearly" : "monthly")}</span>}
          </div>
          {statusLine && <p className="text-xs text-muted-foreground">{statusLine}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <Meter label={t("credits", { used: String(used), total: String(billing.creditsMonthly) })} value={billing.creditsMonthly ? used / billing.creditsMonthly : 0} />
          <Meter
            label={seats === null ? t("seatsUnlimited", { used: String(billing.seatsUsed) }) : t("seats", { used: String(billing.seatsUsed), total: String(seats) })}
            value={seats ? billing.seatsUsed / seats : 0}
          />
          {actionable && billing.hasCustomer && (
            <Button variant="outline" onClick={() => run("portal", openBillingPortal)} disabled={busy !== null} className="h-9 px-4 text-[13px] font-semibold">
              {busy === "portal" ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
              {t("manage")}
            </Button>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold">{t("plansTitle")}</h3>
        {hasYearly && (
          <div role="radiogroup" aria-label={t("interval")} className="flex gap-0.5 rounded-lg border bg-muted p-1">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={interval === value}
                onClick={() => setInterval(value)}
                className={cn("rounded-md px-3.5 py-1 text-xs font-medium text-muted-foreground", interval === value && "bg-background font-semibold text-foreground shadow-xs")}
              >
                {t(value === "month" ? "monthly" : "yearly")}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_IDS.map((plan) => {
          const isCurrent = billing.plan === plan;
          const price = plan === "starter" || plan === "pro" ? billing.prices[plan]?.[interval] : undefined;
          const buyable = price !== undefined;
          const sameAsCurrent = isCurrent && (plan === "free" || billing.interval === interval || !billing.hasSubscription);
          let cta: { label: string; onClick?: () => void } | null = null;
          if (plan === "enterprise") cta = isCurrent ? { label: t("current") } : { label: t("contactSales") };
          else if (sameAsCurrent) cta = { label: plan === "free" && billing.cancelAtPeriodEnd ? t("startsOn", { date: date(billing.periodEnd) }) : t("current") };
          else if (plan === "free") cta = billing.hasSubscription && !billing.cancelAtPeriodEnd ? { label: t("downgrade"), onClick: () => setPending({ plan, kind: "downgrade" }) } : null;
          else if (buyable)
            cta = {
              label: billing.hasSubscription ? t("switchTo", { plan: t(`plans.${plan}.name`) }) : billing.trialDays ? t("startTrial", { days: billing.trialDays }) : t("choose"),
              onClick: billing.hasSubscription ? () => setPending({ plan, kind: "change" }) : () => run(plan, () => choosePlan(plan, interval)),
            };

          return (
            <li key={plan} className={cn("flex flex-col gap-4 rounded-2xl border bg-background p-5", isCurrent && "border-primary ring-1 ring-primary")}>
              <div className="flex flex-col gap-1">
                <h4 className="text-[15px] font-bold">{t(`plans.${plan}.name`)}</h4>
                <p className="text-xs text-muted-foreground">{t(`plans.${plan}.tagline`)}</p>
              </div>
              <p className="min-h-8 text-2xl font-extrabold">
                {plan === "free" ? (
                  money(0, billing.prices.starter?.month?.currency ?? "aed")
                ) : plan === "enterprise" ? (
                  <span className="text-base font-bold">{t("custom")}</span>
                ) : price ? (
                  <>
                    {money(price.amount, price.currency)}
                    <span className="ms-1 text-xs font-medium text-muted-foreground">{t(interval === "year" ? "perYear" : "perMonth")}</span>
                  </>
                ) : billing.enabled ? (
                  <span className="text-xs font-medium text-muted-foreground">{buyable ? t("priceUnavailable") : t("notOffered")}</span>
                ) : null}
              </p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <Feature>{t("creditsPerMonth", { count: billing.planCredits[plan], display: format.number(billing.planCredits[plan], LATN) })}</Feature>
                <Feature>{PLANS[plan].seats === null ? t("unlimitedSeats") : t("seatsCount", { count: PLANS[plan].seats! })}</Feature>
                {PLANS[plan].videoStorageBytes > 0 && <Feature>{t("videoStorage", { size: format.number(PLANS[plan].videoStorageBytes / 1024 ** 3, { ...LATN, style: "unit", unit: "gigabyte", maximumFractionDigits: 0 }), days: PLANS[plan].videoRetentionDays })}</Feature>}
                <Feature>{t("byok")}</Feature>
              </ul>
              <div className="mt-auto">
                {cta &&
                  (cta.onClick && actionable ? (
                    <Button onClick={cta.onClick} disabled={busy !== null} variant={plan === "free" ? "outline" : "default"} className="h-9 w-full text-[13px] font-semibold">
                      {busy === plan && <Loader2 className="animate-spin" aria-hidden />}
                      {cta.label}
                    </Button>
                  ) : (
                    <p className="flex h-9 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">{cta.label}</p>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-md">
          {pending && (
            <>
              <DialogTitle>{pending.kind === "downgrade" ? t("confirm.downgradeTitle") : t("confirm.changeTitle", { plan: t(`plans.${pending.plan}.name`) })}</DialogTitle>
              <DialogDescription>{pending.kind === "downgrade" ? t("confirm.downgradeBody", { date: date(billing.periodEnd) }) : t("confirm.changeBody")}</DialogDescription>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setPending(null)} className="h-9 px-4 text-[13px]">
                  {t("confirm.cancel")}
                </Button>
                <Button
                  onClick={() => run(pending.plan, () => choosePlan(pending.plan, interval))}
                  disabled={busy !== null}
                  variant={pending.kind === "downgrade" ? "destructive" : "default"}
                  className="h-9 px-4 text-[13px] font-semibold"
                >
                  {busy === pending.plan && <Loader2 className="animate-spin" aria-hidden />}
                  {t("confirm.confirm")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header() {
  const t = useTranslations("Billing");
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-bold">{t("title")}</h2>
      <p className="max-w-2xl text-[13px] text-muted-foreground">{t("description")}</p>
    </div>
  );
}

function Notice({ tone, children, action }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode; action?: { label: string; busy: boolean; onClick: () => void } }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs",
        tone === "ok" && "bg-emerald-50 text-emerald-800",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "muted" && "bg-muted",
      )}
    >
      <span>{children}</span>
      {action && (
        <Button size="sm" variant="outline" onClick={action.onClick} disabled={action.busy} className="h-7 text-xs font-semibold">
          {action.busy && <Loader2 className="animate-spin" aria-hidden />}
          {action.label}
        </Button>
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex w-44 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", value >= 0.9 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
      </span>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
      {children}
    </li>
  );
}
