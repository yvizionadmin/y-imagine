import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FaqList } from "@/features/marketing/components/faq-list";
import { LottieSparkle } from "@/features/marketing/components/lottie-sparkle";
import { CtaBand, Eyebrow } from "@/features/marketing/components/marketing-shell";
import { PricingPlans } from "@/features/marketing/components/pricing-plans";
import { ScrollFx } from "@/features/marketing/components/scroll-fx";
import { LEGAL_DETAILS } from "@/features/marketing/legal-details";
import { marketingMetadata, marketingPath, siteUrl } from "@/features/marketing/metadata";
import { publicPricing } from "@/features/marketing/pricing";
import { breadcrumbs, faqPage, JsonLd } from "@/features/marketing/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "pricing");
}

/** Prices and credits are read per request (they change in Stripe and Admin → Credits), never at build. */
async function Plans() {
  await connection();
  return <PricingPlans pricing={await publicPricing()} contactEmail={LEGAL_DETAILS.contactEmail} />;
}

const FAQ = ["keys", "credits", "cost", "video", "cancel"] as const;
const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default async function Pricing({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Marketing.pricing");
  const tn = await getTranslations("Marketing.nav");
  const faq = FAQ.map((key) => ({ key, q: t(`faq.${key}.q`), a: t(`faq.${key}.a`) }));
  return (
    <ScrollFx>
      <JsonLd
        data={[
          breadcrumbs(siteUrl(), [
            { name: tn("home"), path: marketingPath(locale, "home") },
            { name: tn("pricing"), path: marketingPath(locale, "pricing") },
          ]),
          faqPage(faq),
        ]}
      />
      <section className="relative isolate overflow-hidden px-4 pt-[calc(var(--mkt-header)+4rem)] pb-24 sm:px-6 lg:pt-[calc(var(--mkt-header)+6rem)]">
        <div aria-hidden className="mkt-aurora -z-10" />
        <div aria-hidden className="mkt-grid -z-10" />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-14">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <LottieSparkle className="mkt-rise -mb-4 size-20" />
            <Eyebrow className="mkt-rise">{t("eyebrow")}</Eyebrow>
            <h1 className="mkt-display mkt-rise text-[clamp(2.6rem,6.4vw,5.6rem)]" style={stagger(1)}>
              {t("title")}
            </h1>
            <p className="mkt-rise max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={stagger(2)}>
              {t("subtitle")}
            </p>
          </div>
          <div className="mkt-rise" style={stagger(3)}>
            <Suspense fallback={<div className="h-[30rem] w-full animate-pulse rounded-3xl bg-muted/50" />}>
              <Plans />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="border-t px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
            <h2 data-split className="mkt-title">{t("faqTitle")}</h2>
            <p data-reveal className="max-w-sm text-base leading-relaxed text-muted-foreground">
              {t("faqBody")}
            </p>
          </div>
          <FaqList items={faq} />
        </div>
      </section>
      <CtaBand />
    </ScrollFx>
  );
}
