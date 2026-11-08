import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { LanguageLink, ThemeSwitch } from "@/features/auth/components/auth-shell";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { LEGAL_DETAILS } from "../legal-details";

const NAV = [
  { href: "/features", key: "features" },
  { href: "/pricing", key: "pricing" },
] as const;

/** Header and footer of the public site. Static, so the pages load without a session or the database. */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Marketing");
  return (
    <div className="flex min-h-dvh flex-col bg-background font-sans text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Brand />
          <nav aria-label={t("nav.label")} className="hidden items-center gap-5 md:flex">
            <NavLinks />
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Suspense>
              <LanguageLink />
            </Suspense>
            <Link href="/sign-in" className="hidden px-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground sm:block">
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className={cn(buttonVariants({ className: "h-9 px-4 text-[13px] font-semibold" }))}>
              {t("nav.start")}
            </Link>
          </div>
        </div>
        {/* Phones: the page links get their own row, with no menu to open. */}
        <nav aria-label={t("nav.label")} className="flex items-center gap-5 border-t px-4 py-2 sm:px-6 md:hidden">
          <NavLinks />
          <Link href="/sign-in" className="ms-auto text-[13px] font-semibold text-muted-foreground hover:text-foreground sm:hidden">
            {t("nav.signIn")}
          </Link>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex max-w-xs flex-col gap-2">
            <Brand />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("footer.tagline")}</p>
          </div>
          <nav aria-label={t("footer.label")} className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
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
      </footer>
    </div>
  );
}

function Brand() {
  const t = useTranslations("Marketing");
  return (
    <Link href="/" className="flex w-fit items-center gap-2 text-sm font-bold">
      <Sparkles className="size-5 text-primary" aria-hidden />
      {t("brand")}
    </Link>
  );
}

function NavLinks() {
  const t = useTranslations("Marketing.nav");
  return NAV.map(({ href, key }) => (
    <Link key={key} href={href} className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">
      {t(key)}
    </Link>
  ));
}

/** Closing call to action shared by the public pages. */
export function CtaBand() {
  const t = useTranslations("Marketing.cta");
  return (
    <section className="px-4 pb-16 sm:px-6">
      <div className="mx-auto flex w-full max-w-276 flex-col items-center gap-4 rounded-3xl border bg-linear-to-b from-primary/10 to-muted/40 px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t("body")}</p>
        <Link href="/sign-up" className={cn(buttonVariants({ className: "h-10 px-5 text-sm font-semibold" }))}>
          {t("action")}
        </Link>
      </div>
    </section>
  );
}
