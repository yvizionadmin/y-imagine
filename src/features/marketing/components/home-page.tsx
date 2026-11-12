import Image from "next/image";
import { ArrowRight, Boxes, Clapperboard, KeyRound, LayoutTemplate, MessageSquare, Palette, PenLine, ShieldCheck, Star, Wallet, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";
import { BeforeAfter } from "./before-after";
import { LottieSparkle } from "./lottie-sparkle";
import { CtaBand, Eyebrow } from "./marketing-shell";
import { Magnetic, Spotlight, TiltCard } from "./motion";
import { SceneGallery } from "./scene-gallery";
import { ScrollFx } from "./scroll-fx";

const TOOLS = [
  { key: "lifestyle", icon: WandSparkles, span: "sm:col-span-2 lg:row-span-2" },
  { key: "video", icon: Clapperboard, span: "sm:col-span-2" },
  { key: "recolor", icon: Palette },
  { key: "aplus", icon: LayoutTemplate },
  { key: "looks", icon: Star },
  { key: "copy", icon: PenLine },
  { key: "chat", icon: MessageSquare },
  { key: "bulk", icon: Boxes },
] as const;

const STEPS = ["connect", "create", "review"] as const;
const OWN_KEYS = [
  { key: "choice", icon: KeyRound },
  { key: "cost", icon: Wallet },
  { key: "safe", icon: ShieldCheck },
] as const;
/** Brand names, shown as text: the providers whose keys a workspace can connect. */
const PROVIDERS = ["OpenAI", "Anthropic", "Gemini", "OpenRouter", "BytePlus", "Kling"];
const CATEGORIES = ["furniture", "fashion", "cosmetics", "mobile", "decor", "kitchenAppliances", "lighting", "kidsToys", "outdoor", "bathroom", "homeAppliances"];
const SCENES = ["luxury-loft.png", "dusk-dining.jpg", "spa-bathroom.jpg", "patio-terrace.jpg", "editorial-set.jpg", "reading-nook.jpg", "modern-kitchen.jpg", "evening-bedside.jpg", "tech-showroom.jpg", "pool-deck.jpg"];
const SWATCHES = ["#c8643a", "#6f9a7a", "#2c4f8f", "#c9a56b"];

export const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function HomePage() {
  return (
    <ScrollFx>
      <Hero />
      <Providers />
      <Tools />
      <Gallery />
      <Steps />
      <OwnKeys />
      <Bilingual />
      <CtaBand />
    </ScrollFx>
  );
}

function Hero() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="relative isolate overflow-hidden px-4 pt-[calc(var(--mkt-header)+3.5rem)] pb-24 sm:px-6 lg:pt-[calc(var(--mkt-header)+5.5rem)]">
      <div aria-hidden className="mkt-aurora -z-10" />
      <div aria-hidden className="mkt-grid -z-10" />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        <div className="flex flex-col items-start gap-7">
          <Eyebrow className="mkt-rise">{t("eyebrow")}</Eyebrow>
          <h1 className="mkt-display mkt-rise text-[clamp(2.6rem,6vw,4.9rem)]" style={stagger(1)}>
            {t.rich("title", { em: (chunks) => <em className="mkt-serif mkt-gradient-text">{chunks}</em> })}
          </h1>
          <p className="mkt-rise max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={stagger(2)}>
            {t("subtitle")}
          </p>
          <div className="mkt-rise flex flex-wrap items-center gap-3" style={stagger(3)}>
            <Magnetic>
              <Link
                href="/sign-up"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-[0_12px_40px_-12px_var(--primary)] transition-transform hover:scale-[1.03]"
              >
                {t("primary")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
              </Link>
            </Magnetic>
            <Link href="/features" className="inline-flex h-12 items-center rounded-full border bg-background/60 px-7 text-sm font-semibold backdrop-blur transition-colors hover:bg-muted">
              {t("secondary")}
            </Link>
          </div>
          <p className="mkt-rise text-xs text-muted-foreground" style={stagger(4)}>
            {t("note")}
          </p>
        </div>

        <figure className="mkt-rise relative" style={stagger(2)}>
          <div data-hero-media className="relative">
            <div className="relative isolate rounded-[2rem]">
              <div aria-hidden className="mkt-halo" />
              <div className="mkt-ring rounded-[2rem] p-1.5 shadow-2xl">
                <BeforeAfter
                  priority
                  className="aspect-[1184/864] rounded-[1.6rem]"
                  sizes="(min-width: 1024px) 560px, 100vw"
                  before={{ src: "/demo/sofa-grey-base.png", alt: t("compare.beforeAlt") }}
                  after={{ src: "/demo/lifestyle-living-room.png", alt: t("heroAlt") }}
                  labels={{ before: t("compare.before"), after: t("compare.after"), slider: t("compare.label") }}
                />
              </div>
            </div>

            <div className="absolute inset-x-3 -bottom-7 flex items-center gap-3 rounded-2xl border bg-background/85 p-2.5 shadow-xl backdrop-blur-xl sm:inset-x-8">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12">
                <LottieSparkle className="size-9" />
              </span>
              <span className="mkt-caret min-w-0 text-xs leading-snug font-medium sm:text-[13px]">{t("heroPrompt")}</span>
            </div>

            <div aria-hidden className="mkt-float absolute -top-5 -start-5 hidden items-center gap-1.5 rounded-2xl border bg-background/85 p-2 shadow-xl backdrop-blur-xl lg:flex">
              <Palette className="size-4 text-muted-foreground" />
              {SWATCHES.map((color) => (
                <span key={color} className="size-5 rounded-full border border-black/10" style={{ background: color }} />
              ))}
            </div>
            <div aria-hidden className="mkt-float absolute top-1/3 -end-6 hidden flex-col gap-1.5 rounded-2xl border bg-background/85 p-1.5 shadow-xl backdrop-blur-xl xl:flex" style={stagger(1)}>
              {["fashion", "cosmetics", "decor"].map((key) => (
                <Image key={key} src={`/templates/${key}.jpg`} alt="" width={56} height={56} className="size-14 rounded-xl object-cover" />
              ))}
            </div>
          </div>

          <figcaption className="mt-12 text-center text-[11px] text-muted-foreground">{t("heroCaption")}</figcaption>
        </figure>
      </div>
    </section>
  );
}

function Providers() {
  const t = useTranslations("Marketing.home");
  return (
    <section aria-labelledby="providers-title" className="border-y bg-muted/20 py-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 sm:flex-row sm:gap-10 sm:px-6">
        <h2 id="providers-title" className="shrink-0 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {t("providers")}
        </h2>
        <div className="mkt-marquee-mask w-full min-w-0">
          <div className="mkt-marquee" style={{ "--mkt-duration": "28s" } as React.CSSProperties}>
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 || undefined} className="flex shrink-0 items-center gap-14 pe-14">
                {PROVIDERS.map((name) => (
                  <li key={name} className="text-xl font-semibold tracking-tight whitespace-nowrap text-foreground/55 sm:text-2xl">
                    {name}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Tools() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-24 sm:px-6 sm:py-32">
      <SectionHeading index="01" title={t("tools.title")} body={t("tools.body")} />
      <Spotlight>
        <ul className="grid auto-rows-[minmax(14rem,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map(({ key, icon: Icon, ...rest }, i) => {
            const media = key === "lifestyle" || key === "video";
            return (
              <li key={key} data-reveal className={cn("flex", "span" in rest && rest.span)}>
                <TiltCard className={cn("mkt-spot group flex w-full flex-col overflow-hidden rounded-3xl border bg-card/60 p-6", media && "justify-end text-white")}>
                  {key === "lifestyle" && (
                    <Image src="/scenes/luxury-loft.png" alt="" fill sizes="(min-width: 1024px) 560px, 100vw" className="-z-10 object-cover transition-transform duration-700 group-hover:scale-105" />
                  )}
                  {key === "video" && (
                    <video
                      aria-hidden
                      src="/demo/demo-video.webm"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  )}
                  {media && <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-black/85 via-black/30 to-transparent" />}
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn("flex size-11 items-center justify-center rounded-2xl", media ? "bg-white/15 backdrop-blur" : "bg-primary/12 text-primary")}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span aria-hidden className={cn("text-xs font-semibold tabular-nums", media ? "text-white/70" : "text-muted-foreground")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className={cn("flex flex-col gap-2", media ? "mt-auto pt-24" : "mt-auto pt-8")}>
                    <h3 className={cn("font-semibold tracking-tight", key === "lifestyle" ? "text-2xl sm:text-3xl" : "text-lg")}>{t(`tools.items.${key}.title`)}</h3>
                    <p className={cn("text-sm leading-relaxed", media ? "max-w-sm text-white/75" : "text-muted-foreground")}>{t(`tools.items.${key}.body`)}</p>
                  </div>
                </TiltCard>
              </li>
            );
          })}
        </ul>
      </Spotlight>
    </section>
  );
}

function Gallery() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="flex flex-col gap-14 overflow-hidden py-24 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading index="02" title={t("gallery.title")} body={t("gallery.body")} />
      </div>
      <SceneGallery categories={CATEGORIES} scenes={SCENES} labels={{ previous: t("gallery.previous"), next: t("gallery.next"), region: t("gallery.region") }} />
    </section>
  );
}

function Steps() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="border-y bg-muted/20">
      <div data-steps className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-24 sm:px-6 sm:py-32">
        <SectionHeading index="03" title={t("steps.title")} />
        <ol className="relative grid gap-12 md:grid-cols-3 md:gap-8">
          <span aria-hidden data-draw className="absolute inset-x-0 top-0 hidden h-px origin-left bg-linear-to-r from-primary via-[#ec4899] to-[#38bdf8] md:block rtl:origin-right rtl:bg-linear-to-l" />
          {STEPS.map((key, i) => (
            <li key={key} data-step className="relative flex flex-col gap-4 md:pt-8">
              <div className="flex items-center justify-between">
                <span aria-hidden className="mkt-outline-num text-[5.5rem] leading-none font-semibold tracking-tighter">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <LottieSparkle className="size-16" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">{t(`steps.${key}.title`)}</h3>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function OwnKeys() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="px-4 py-24 sm:px-6 sm:py-32">
      <div data-reveal-scale className="relative mx-auto grid w-full max-w-276 gap-12 overflow-hidden rounded-[2.5rem] bg-[#0a0a0f] p-7 text-white sm:p-12 lg:grid-cols-[1fr_1.2fr] lg:p-16">
        <div aria-hidden className="mkt-grid opacity-60 invert" />
        <div className="relative flex flex-col gap-6">
          <h2 data-split className="mkt-title">
            {t("keys.title")}
          </h2>
          <p className="max-w-md text-base leading-relaxed text-white/70">{t("keys.body")}</p>
          <p className="mt-auto flex items-end gap-3">
            <span className="mkt-gradient-text text-[clamp(5rem,12vw,9rem)] leading-[0.8] font-bold tracking-tighter">{t("keys.stat")}</span>
            <span className="max-w-32 pb-2 text-sm leading-snug text-white/70">{t("keys.statLabel")}</span>
          </p>
        </div>
        <Spotlight className="relative">
          <ul className="flex flex-col gap-3">
            {OWN_KEYS.map(({ key, icon: Icon }) => (
              <li key={key} data-reveal className="mkt-spot flex gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#a78bfa]">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold">{t(`keys.${key}.title`)}</h3>
                  <p className="text-sm leading-relaxed text-white/65">{t(`keys.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Spotlight>
      </div>
    </section>
  );
}

function Bilingual() {
  const t = useTranslations("Marketing.home");
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-4 pb-8 text-center sm:px-6">
      <p aria-hidden className="mkt-swap text-[clamp(4rem,14vw,10rem)] leading-[1.1] font-semibold tracking-tight">
        <span lang="en" className="mkt-serif mkt-gradient-text">
          Imagine
        </span>
        <span lang="ar" className="mkt-gradient-text font-[family-name:var(--font-cairo)] font-bold">
          تخيّل
        </span>
      </p>
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 data-split className="mkt-title">
          {t("arabic.title")}
        </h2>
        <p data-reveal className="text-base leading-relaxed text-muted-foreground">
          {t("arabic.body")}
        </p>
      </div>
    </section>
  );
}

/** Numbered section title; GSAP splits the heading into rising words. */
export function SectionHeading({ index, title, body, className }: { index?: string; title: string; body?: string; className?: string }) {
  return (
    <div className={cn("flex max-w-3xl flex-col gap-4", className)}>
      {index && (
        <span aria-hidden data-reveal className="flex items-center gap-3 text-xs font-semibold tracking-[0.25em] text-primary">
          {index}
          <span className="h-px w-10 bg-primary/50" />
        </span>
      )}
      <h2 data-split className="mkt-title">
        {title}
      </h2>
      {body && (
        <p data-reveal className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {body}
        </p>
      )}
    </div>
  );
}
