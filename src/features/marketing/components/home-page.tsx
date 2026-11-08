import Image from "next/image";
import { Boxes, Clapperboard, Images, KeyRound, Languages, LayoutTemplate, MessageSquare, Palette, PenLine, ShieldCheck, Star, Wallet, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { CtaBand } from "./marketing-shell";

const TOOLS = [
  { key: "lifestyle", icon: WandSparkles },
  { key: "video", icon: Clapperboard },
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
const CATEGORIES = ["furniture", "fashion", "cosmetics", "mobile"] as const;

export function HomePage() {
  const t = useTranslations("Marketing.home");
  return (
    <>
      <section className="bg-linear-to-b from-primary/10 via-primary/5 to-transparent px-4 pt-14 pb-12 sm:px-6 sm:pt-20">
        <div className="mx-auto grid w-full max-w-276 items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-start gap-5">
            <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
              {t.rich("title", { em: (chunks) => <em className="font-serif font-bold italic rtl:font-sans rtl:not-italic rtl:text-primary">{chunks}</em> })}
            </h1>
            <p className="max-w-lg text-base leading-relaxed text-muted-foreground">{t("subtitle")}</p>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/sign-up" className={cn(buttonVariants({ className: "h-10 px-5 text-sm font-semibold" }))}>
                {t("primary")}
              </Link>
              <Link href="/features" className={cn(buttonVariants({ variant: "outline", className: "h-10 px-5 text-sm font-semibold" }))}>
                {t("secondary")}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">{t("note")}</p>
          </div>
          <figure className="flex flex-col gap-2">
            <div className="relative overflow-hidden rounded-3xl border shadow-sm">
              <Image src="/demo/lifestyle-living-room.png" alt={t("heroAlt")} width={1184} height={864} priority sizes="(min-width: 1024px) 50vw, 100vw" className="h-auto w-full" />
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2.5 rounded-xl border bg-background/90 p-2.5 backdrop-blur sm:inset-x-5 sm:bottom-5">
                <Images className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 text-xs leading-snug font-medium">{t("heroPrompt")}</span>
              </div>
            </div>
            <figcaption className="text-center text-[11px] text-muted-foreground">{t("heroCaption")}</figcaption>
          </figure>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6">
        <Heading title={t("tools.title")} body={t("tools.body")} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{t(`tools.items.${key}.title`)}</h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t(`tools.items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {CATEGORIES.map((key) => (
            <li key={key} className="relative aspect-[4/3] overflow-hidden rounded-2xl border">
              <Image src={`/templates/${key}.jpg`} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6">
          <Heading title={t("steps.title")} />
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((key, i) => (
              <li key={key} className="flex flex-col gap-2">
                <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <h3 className="text-sm font-semibold">{t(`steps.${key}.title`)}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{t(`steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6">
        <div className="mx-auto flex w-full max-w-276 flex-col gap-8 rounded-3xl bg-[#0a0a0f] p-6 text-white sm:p-10">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("keys.title")}</h2>
            <p className="text-sm leading-relaxed text-white/70">{t("keys.body")}</p>
          </div>
          <ul className="grid gap-5 md:grid-cols-3">
            {OWN_KEYS.map(({ key, icon: Icon }) => (
              <li key={key} className="flex flex-col gap-2">
                <Icon className="size-5 text-[#a78bfa]" aria-hidden />
                <h3 className="text-sm font-semibold">{t(`keys.${key}.title`)}</h3>
                <p className="text-[13px] leading-relaxed text-white/70">{t(`keys.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 pb-14 text-center sm:px-6">
        <Languages className="size-6 text-primary" aria-hidden />
        <Heading title={t("arabic.title")} body={t("arabic.body")} />
      </section>

      <CtaBand />
    </>
  );
}

export function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {body && <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}
