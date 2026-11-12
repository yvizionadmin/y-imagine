import Image from "next/image";
import { BarChart3, Boxes, Check, Clapperboard, ImageIcon, MessageSquare, PenLine, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { SectionHeading, stagger } from "./home-page";
import { LottieSparkle } from "./lottie-sparkle";
import { CtaBand, Eyebrow } from "./marketing-shell";
import { Spotlight } from "./motion";
import { RecolorDemo } from "./recolor-demo";
import { ScrollFx } from "./scroll-fx";

export const FEATURE_GROUPS = [
  { key: "images", icon: ImageIcon, points: ["lifestyle", "recolor", "aplus", "looks", "resize"] },
  { key: "video", icon: Clapperboard, points: ["prompt", "frame", "models", "consent"] },
  { key: "copy", icon: PenLine, points: ["languages", "brand", "review"] },
  { key: "chat", icon: MessageSquare, points: ["stream", "history", "brand"] },
  { key: "bulk", icon: Boxes, points: ["catalog", "bulk", "history"] },
  { key: "team", icon: Users, points: ["roles", "keys", "seats"] },
  { key: "insight", icon: BarChart3, points: ["analytics", "credits", "links"] },
] as const;

export function FeaturesPage() {
  const t = useTranslations("Marketing.features");
  return (
    <ScrollFx>
      <section className="relative isolate overflow-hidden px-4 pt-[calc(var(--mkt-header)+4rem)] pb-20 sm:px-6 lg:pt-[calc(var(--mkt-header)+6rem)]">
        <div aria-hidden className="mkt-aurora -z-10" />
        <div aria-hidden className="mkt-grid -z-10" />
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 text-center">
          <LottieSparkle className="mkt-rise -mb-4 size-20" />
          <Eyebrow className="mkt-rise">{t("eyebrow")}</Eyebrow>
          <h1 className="mkt-display mkt-rise max-w-4xl" style={stagger(1)}>
            {t("title")}
          </h1>
          <p className="mkt-rise max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={stagger(2)}>
            {t("subtitle")}
          </p>
          <nav aria-label={t("jump")} className="mkt-rise mt-2" style={stagger(3)}>
            <ul className="flex flex-wrap justify-center gap-2">
              {FEATURE_GROUPS.map(({ key, icon: Icon }) => (
                <li key={key}>
                  <a
                    href={`#${key}`}
                    className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-2 text-[13px] font-semibold backdrop-blur transition-colors hover:border-primary hover:text-primary"
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {t(`groups.${key}.title`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="flex flex-col gap-5">
            <SectionHeading index="✦" title={t("demo.title")} body={t("demo.body")} />
            <p data-reveal className="text-xs text-muted-foreground">
              {t("demo.note")}
            </p>
          </div>
          <div data-reveal-scale>
            <RecolorDemo
              alt={t("demo.alt")}
              label={t("demo.label")}
              names={{
                original: t("demo.colors.original"),
                sage: t("demo.colors.sage"),
                terracotta: t("demo.colors.terracotta"),
                navy: t("demo.colors.navy"),
                sand: t("demo.colors.sand"),
              }}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-16 sm:px-6">
        {FEATURE_GROUPS.map(({ key, icon: Icon, points }, i) => (
          <section key={key} id={key} aria-labelledby={`${key}-title`} className="grid scroll-mt-28 gap-8 border-t py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-24">
            <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
              <span aria-hidden data-parallax="18" className="mkt-outline-num text-[clamp(4.5rem,9vw,7.5rem)] leading-[0.85] font-semibold tracking-tighter">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h2 id={`${key}-title`} data-split className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {t(`groups.${key}.title`)}
                </h2>
              </span>
              <GroupVisual group={key} />
            </div>
            <Spotlight>
              <ul className="flex flex-col gap-3">
                {points.map((point) => (
                  <li key={point} data-reveal className="mkt-spot flex items-start gap-4 rounded-2xl border bg-card/60 p-5 sm:p-6">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-base leading-relaxed sm:text-lg">{t(`groups.${key}.${point}`)}</span>
                  </li>
                ))}
              </ul>
            </Spotlight>
          </section>
        ))}
      </div>
      <CtaBand />
    </ScrollFx>
  );
}

/** A picture beside the groups that have one to show. */
function GroupVisual({ group }: { group: (typeof FEATURE_GROUPS)[number]["key"] }) {
  if (group === "images")
    return (
      <div aria-hidden className="mt-2 hidden grid-cols-3 gap-2 lg:grid">
        {["furniture", "fashion", "cosmetics"].map((key) => (
          <div key={key} data-reveal className="relative aspect-[3/4] overflow-hidden rounded-2xl border">
            <Image data-parallax="8" src={`/templates/${key}.jpg`} alt="" fill sizes="160px" className="scale-115 object-cover" />
          </div>
        ))}
      </div>
    );
  if (group === "video")
    return (
      <div aria-hidden className="mt-2 hidden aspect-video overflow-hidden rounded-2xl border lg:block">
        <video src="/demo/demo-video.webm" autoPlay muted loop playsInline preload="metadata" className="size-full object-cover" />
      </div>
    );
  return null;
}
