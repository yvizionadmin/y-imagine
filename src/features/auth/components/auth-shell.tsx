"use client";

import { Suspense } from "react";
import { Monitor, Moon, Sparkles, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import { setTheme, THEMES, useTheme, type Theme } from "@/components/app/theme";
import { Link, usePathname } from "@/i18n/navigation";

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } satisfies Record<Theme, unknown>;
const TOOLS = ["generate", "recolor", "aplus", "looks", "resize"] as const;

/**
 * Sign-in / sign-up frame. No Figma frame exists for auth; the brand panel borrows the case-study
 * cover (35:1714: near-black, violet glow, accent bar) and stays dark in both themes, while the
 * form panel follows the user's theme.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Auth");

  return (
    <div className="flex min-h-dvh bg-background font-sans text-foreground">
      <aside className="relative hidden w-[46%] max-w-[720px] shrink-0 flex-col justify-between overflow-hidden bg-[#0a0a0f] p-12 text-white lg:flex">
        <span aria-hidden className="pointer-events-none absolute -end-40 -top-48 size-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.45),transparent)]" />
        <span aria-hidden className="pointer-events-none absolute -start-28 bottom-10 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.25),transparent)]" />

        <Link href="/" className="relative flex w-fit items-center gap-2 text-sm font-bold tracking-wide">
          <Sparkles className="size-6 text-[#a78bfa]" aria-hidden />
          {t("brandMark")}
        </Link>

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl leading-tight font-extrabold tracking-tight">{t("brandTitle")}</h1>
            <span aria-hidden className="h-2 w-40 rounded-full bg-[#7c5cff]" />
          </div>
          <p className="max-w-md text-lg leading-relaxed text-white/70">{t("brandBody")}</p>
          <ul className="flex flex-wrap gap-2">
            {TOOLS.map((tool) => (
              <li key={tool} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[13px] text-white/80">
                {t(`tools.${tool}`)}
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-white/80">
            <span aria-hidden className="h-6 w-1 rounded-full bg-[#7c5cff]" />
            {t("byok")}
          </p>
        </div>

        <p className="relative text-xs text-white/40">{t("footer")}</p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold lg:invisible">
            <Sparkles className="size-5 text-primary" aria-hidden />
            {t("brandMark")}
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            <Suspense>
              <LanguageLink />
            </Suspense>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function ThemeSwitch() {
  const t = useTranslations("Shell");
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label={t("theme")} className="flex gap-0.5 rounded-lg border bg-background p-0.5">
      {THEMES.map((value) => {
        const Icon = THEME_ICON[value];
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={t(`themes.${value}`)}
            title={t(`themes.${value}`)}
            onClick={() => setTheme(value)}
            className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground", theme === value && "bg-muted text-foreground")}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function LanguageLink() {
  const t = useTranslations("Shell");
  const pathname = usePathname();
  const locale = useLocale();
  return (
    <Link
      href={pathname}
      locale={locale === "ar" ? "en" : "ar"}
      aria-label={t("languageLabel")}
      className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
    >
      {t("language")}
    </Link>
  );
}
