"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { PLAN_IDS, PLANS, isPaidPlan, type PlanId } from "@/lib/plans";
import type { PublicPricing } from "../pricing";
import { Spotlight } from "./motion";

type Interval = "month" | "year";

/** The plan cards, with amounts from Stripe. A plan with no amount available says so instead of guessing. */
export function PricingPlans({ pricing, contactEmail }: { pricing: PublicPricing; contactEmail: string | null }) {
  const t = useTranslations("Marketing.pricing");
  const tb = useTranslations("Billing");
  const format = useFormatter();
  const [interval, setInterval] = useState<Interval>("month");
  const reduce = useReducedMotion();
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
        <div role="radiogroup" aria-label={tb("interval")} className="grid grid-cols-2 rounded-full border bg-background/70 p-1 backdrop-blur">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={interval === value}
              onClick={() => setInterval(value)}
              className={cn(
                "relative isolate min-w-28 rounded-full px-5 py-2 text-[13px] font-semibold text-muted-foreground transition-colors",
                interval === value && "text-background",
              )}
            >
              {interval === value && (
                <motion.span layoutId="interval-pill" aria-hidden className="absolute inset-0 -z-10 rounded-full bg-foreground shadow" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              {tb(value === "month" ? "monthly" : "yearly")}
            </button>
          ))}
        </div>
      )}

      <Spotlight className="w-full">
      <ul className="grid w-full items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_IDS.map((plan) => {
          const { seats, videoStorageBytes, videoRetentionDays } = PLANS[plan];
          const hasVideo = videoStorageBytes > 0;
          const credits = pricing.planCredits[plan];
          return (
            <motion.li
              key={plan}
              whileHover={reduce ? undefined : { y: -8 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className={cn(
                "mkt-spot relative flex flex-col gap-5 rounded-3xl border bg-card/70 p-6 backdrop-blur",
                plan === "pro" && "mkt-ring shadow-[0_30px_80px_-30px_var(--primary)] lg:-my-3 lg:py-9",
              )}
            >
              <div className="flex flex-col gap-1.5">
                <h2 className="text-lg font-bold tracking-tight">{tb(`plans.${plan}.name`)}</h2>
                <p className="min-h-8 text-[13px] leading-snug text-muted-foreground">{tb(`plans.${plan}.tagline`)}</p>
              </div>
              <div className="relative min-h-10 overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={interval}
                    initial={reduce ? false : { y: "100%", opacity: 0, filter: "blur(6px)" }}
                    animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                    exit={reduce ? undefined : { y: "-100%", opacity: 0, filter: "blur(6px)" }}
                    transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
                    className="text-4xl font-bold tracking-tight"
                  >
                    {amount(plan)}
                  </motion.p>
                </AnimatePresence>
              </div>
              <ul className="flex flex-col gap-2.5 border-t pt-5 text-[13px]">
                <Item>{tb("creditsPerMonth", { count: credits, display: format.number(credits, LATN) })}</Item>
                <Item>{seats === null ? tb("unlimitedSeats") : tb("seatsCount", { count: seats })}</Item>
                <Item>{tb("byok")}</Item>
                {hasVideo ? <Item>{tb("videoStorage", { size: size(videoStorageBytes), days: videoRetentionDays })}</Item> : <Item off>{t("noVideo")}</Item>}
              </ul>
              <div className="mt-auto pt-2">
                {plan === "enterprise" && contactEmail ? (
                  <a href={`mailto:${contactEmail}`} className={cn(buttonVariants({ variant: "outline", className: "h-11 w-full rounded-full text-[13px] font-semibold" }))}>
                    {t("contact")}
                  </a>
                ) : (
                  <Link
                    href={plan === "free" ? "/sign-up" : { pathname: "/sign-up", query: { next: "/settings/billing" } }}
                    className={cn(buttonVariants({ variant: plan === "pro" ? "default" : "outline", className: "h-11 w-full rounded-full text-[13px] font-semibold" }))}
                  >
                    {t(plan === "free" ? "startFree" : "choose")}
                  </Link>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
      </Spotlight>

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
