"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { PLAN_IDS, PLANS, isPaidPlan, type PlanId } from "@/lib/plans";
import type { PublicPricing } from "../pricing";

type Interval = "month" | "year";

/** The plan cards, with amounts from Stripe. A plan with no amount available says so instead of guessing. */
export function PricingPlans({ pricing, contactEmail }: { pricing: PublicPricing; contactEmail: string | null }) {
  const t = useTranslations("Marketing.pricing");
  const tb = useTranslations("Billing");
  const format = useFormatter();
  const [interval, setInterval] = useState<Interval>("month");
  const hasYearly = Object.values(pricing.prices).some((p) => p?.year);
  // Same currency as the paid plans; Stripe prices are in AED.
  const currency = Object.values(pricing.prices).flatMap((p) => Object.values(p ?? {}))[0]?.currency ?? "aed";

  const money = (amount: number, currency: string) =>
    format.number(amount / 100, { ...LATN, style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: amount % 100 ? 2 : 0 });
  const size = (bytes: number) => format.number(bytes / 1024 ** 3, { ...LATN, style: "unit", unit: "gigabyte", maximumFractionDigits: 0 });

  function amount(plan: PlanId) {
    if (plan === "free") return <span>{money(0, currency)}</span>;
    if (plan === "enterprise") return <span>{tb("custom")}</span>;
    const price = isPaidPlan(plan) ? pricing.prices[plan]?.[interval] : undefined;
    if (!price) return <span className="text-sm font-medium text-muted-foreground">{t("priceOnRequest")}</span>;
    return (
      <>
        {money(price.amount, price.currency)}
        <span className="ms-1 text-xs font-medium text-muted-foreground">{tb(interval === "year" ? "perYear" : "perMonth")}</span>
      </>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {hasYearly && (
        <div role="radiogroup" aria-label={tb("interval")} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={interval === value}
              onClick={() => setInterval(value)}
              className={cn("rounded-md px-3.5 py-1.5 text-xs font-semibold text-muted-foreground", interval === value && "bg-background text-foreground shadow-sm")}
            >
              {tb(value === "month" ? "monthly" : "yearly")}
            </button>
          ))}
        </div>
      )}

      <ul className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_IDS.map((plan) => {
          const { seats, videoStorageBytes, videoRetentionDays } = PLANS[plan];
          const hasVideo = videoStorageBytes > 0;
          const credits = pricing.planCredits[plan];
          return (
            <li key={plan} className={cn("flex flex-col gap-4 rounded-2xl border bg-background p-5", plan === "pro" && "border-primary shadow-sm")}>
              <div className="flex flex-col gap-1">
                <h2 className="text-[15px] font-bold">{tb(`plans.${plan}.name`)}</h2>
                <p className="min-h-8 text-xs leading-snug text-muted-foreground">{tb(`plans.${plan}.tagline`)}</p>
              </div>
              <p className="min-h-8 text-2xl font-extrabold">{amount(plan)}</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <Item>{tb("creditsPerMonth", { count: credits, display: format.number(credits, LATN) })}</Item>
                <Item>{seats === null ? tb("unlimitedSeats") : tb("seatsCount", { count: seats })}</Item>
                <Item>{tb("byok")}</Item>
                {hasVideo ? <Item>{tb("videoStorage", { size: size(videoStorageBytes), days: videoRetentionDays })}</Item> : <Item off>{t("noVideo")}</Item>}
              </ul>
              <div className="mt-auto pt-2">
                {plan === "enterprise" && contactEmail ? (
                  <a href={`mailto:${contactEmail}`} className={cn(buttonVariants({ variant: "outline", className: "h-9 w-full text-[13px] font-semibold" }))}>
                    {t("contact")}
                  </a>
                ) : (
                  <Link
                    href={plan === "free" ? "/sign-up" : { pathname: "/sign-up", query: { next: "/settings/billing" } }}
                    className={cn(buttonVariants({ variant: plan === "pro" ? "default" : "outline", className: "h-9 w-full text-[13px] font-semibold" }))}
                  >
                    {t(plan === "free" ? "startFree" : "choose")}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {pricing.trialDays > 0 && <p className="text-xs text-muted-foreground">{t("trial", { days: pricing.trialDays })}</p>}
    </div>
  );
}

function Item({ children, off }: { children: React.ReactNode; off?: boolean }) {
  const Icon = off ? Minus : Check;
  return (
    <li className={cn("flex items-start gap-2", off && "text-muted-foreground")}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", !off && "text-primary")} aria-hidden />
      <span>{children}</span>
    </li>
  );
}
