import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CtaBand } from "@/features/marketing/components/marketing-shell";
import { PricingPlans } from "@/features/marketing/components/pricing-plans";
import { LEGAL_DETAILS } from "@/features/marketing/legal-details";
import { marketingMetadata } from "@/features/marketing/metadata";
import { publicPricing } from "@/features/marketing/pricing";

export async function generateMetadata({ params }: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "pricing");
}

/** Prices and credits are read per request (they change in Stripe and Admin → Credits), never at build. */
async function Plans() {
  await connection();
  return <PricingPlans pricing={await publicPricing()} contactEmail={LEGAL_DETAILS.contactEmail} />;
}

const FAQ = ["keys", "credits", "cost", "video", "cancel"] as const;

export default async function Pricing({ params }: PageProps<"/[locale]/pricing">) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("Marketing.pricing");
  return (
    <>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-14 pb-16 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{t("subtitle")}</p>
        </div>
        <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-2xl bg-muted/50" />}>
          <Plans />
        </Suspense>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{t("faqTitle")}</h2>
          {FAQ.map((key) => (
            <details key={key} className="group rounded-xl border bg-background px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold">{t(`faq.${key}.q`)}</summary>
              <p className="pt-2 text-[13px] leading-relaxed text-muted-foreground">{t(`faq.${key}.a`)}</p>
            </details>
          ))}
        </div>
      </section>
      <CtaBand />
    </>
  );
}
