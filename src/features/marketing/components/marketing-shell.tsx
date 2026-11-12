import { Suspense } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { LanguageLink, ThemeSwitch } from "@/features/auth/components/auth-shell";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { LEGAL_DETAILS } from "../legal-details";
import { Magnetic } from "./motion";

const NAV = [
  { href: "/features", key: "features" },
  { href: "/pricing", key: "pricing" },
] as const;

/** Header and footer of the public site. Static, so the pages load without a session or the database. */
export function MarketingShell({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useTranslations("Marketing");
  return (
    <div className={cn("mkt flex min-h-dvh flex-col overflow-x-clip bg-background font-sans text-foreground", className)}>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:start-3"
      >
        {t("nav.skip")}
      </a>
      <div aria-hidden className="mkt-progress" />
      <header className="fixed inset-x-0 top-0 z-30 px-3 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-6xl rounded-2xl border bg-background/70 shadow-[0_8px_32px_-12px_rgba(0,0,0,.25)] backdrop-blur-xl">
          <div className="flex h-14 items-center gap-6 px-3 sm:px-4">
            <Brand />
            <nav aria-label={t("nav.label")} className="hidden items-center gap-1 md:flex">
              <NavLinks pill />
            </nav>
            <div className="ms-auto flex items-center gap-2">
              <Suspense>
                <LanguageLink />
              </Suspense>
              <Link href="/sign-in" className="hidden px-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground sm:block">
                {t("nav.signIn")}
              </Link>
              <Link href="/sign-up" className={cn(buttonVariants({ className: "group h-9 rounded-xl px-4 text-[13px] font-semibold" }))}>
                {t("nav.start")}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </Link>
            </div>
          </div>
          {/* Phones: the page links get their own row, with no menu to open. */}
          <nav aria-label={t("nav.label")} className="flex items-center gap-5 border-t px-4 py-2 md:hidden">
            <NavLinks />
            <Link href="/sign-in" className="ms-auto text-[13px] font-semibold text-muted-foreground hover:text-foreground sm:hidden">
              {t("nav.signIn")}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="relative overflow-hidden border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-14 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex max-w-xs flex-col gap-3">
            <Brand />
            <p className="text-sm leading-relaxed text-muted-foreground">{t("footer.tagline")}</p>
          </div>
          <nav aria-label={t("footer.label")} className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <NavLinks />
            <Link href="/terms" className="hover:text-foreground">
              {t("footer.terms")}
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              {t("footer.privacy")}
            </Link>
            {LEGAL_DETAILS.contactEmail && (
              <a href={`mailto:${LEGAL_DETAILS.contactEmail}`} className="hover:text-foreground">
                {t("footer.contact")}
              </a>
            )}
          </nav>
          <div className="w-fit">
            <ThemeSwitch />
          </div>
        </div>
        <p aria-hidden className="mkt-wordmark mx-auto mt-10 w-full max-w-7xl px-4 text-center whitespace-nowrap">
          {t("brand")}
        </p>
      </footer>
    </div>
  );
}

function Brand() {
  const t = useTranslations("Marketing");
  return (
    <Link href="/" className="flex w-fit items-center gap-2 text-sm font-bold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg bg-linear-to-br from-primary via-[#ec4899] to-[#38bdf8] text-white shadow-[0_4px_16px_-4px_var(--primary)]">
        <Sparkles className="size-4" aria-hidden />
      </span>
      {t("brand")}
    </Link>
  );
}

function NavLinks({ pill }: { pill?: boolean }) {
  const t = useTranslations("Marketing.nav");
  return NAV.map(({ href, key }) => (
    <Link
      key={key}
      href={href}
      className={cn(
        "text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
        pill && "rounded-lg px-3 py-1.5 hover:bg-muted",
      )}
    >
      {t(key)}
    </Link>
  ));
}

/** Closing call to action shared by the public pages. */
export function CtaBand() {
  const t = useTranslations("Marketing.cta");
  return (
    <section className="px-4 py-20 sm:px-6">
      <div data-reveal-scale className="relative mx-auto flex w-full max-w-276 flex-col items-center gap-6 overflow-hidden rounded-[2.5rem] border bg-[#0a0a0f] px-6 py-20 text-center text-white sm:py-28">
        <div aria-hidden className="mkt-aurora" />
        <div aria-hidden className="mkt-grain" />
        <h2 className="mkt-title relative max-w-3xl">{t("title")}</h2>
        <p className="relative max-w-xl text-base leading-relaxed text-white/70">{t("body")}</p>
        <Magnetic>
          <Link
            href="/sign-up"
            className="group relative inline-flex h-14 items-center gap-2 rounded-full bg-white px-8 text-base font-semibold text-black shadow-[0_0_60px_-10px_rgba(255,255,255,.6)] transition-transform hover:scale-[1.03]"
          >
            {t("action")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
          </Link>
        </Magnetic>
      </div>
    </section>
  );
}

/** Small pill above a page title. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("mkt-eyebrow", className)}>
      <i aria-hidden />
      {children}
    </span>
  );
}
