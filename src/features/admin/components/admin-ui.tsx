"use client";

import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { adminItems } from "@/components/app/nav-items";
import { UserMenu } from "@/components/app/user-menu";
import { Link, usePathname } from "@/i18n/navigation";

// Super-admin console chrome and shared bits. Same light + icon-rail tokens as the app; the console
// has no Figma frame, so it follows the Team / Analytics screens (30:430, 30:6 restyled).

export function AdminTopBar({ user }: { user: { name: string; email: string } }) {
  const t = useTranslations("Admin");
  return (
    <header className="flex h-topbar shrink-0 items-center gap-6 bg-topbar px-[27px] font-ui text-topbar-foreground max-md:gap-2 max-md:px-3">
      <Link href="/home" className="text-xl font-bold tracking-tight whitespace-nowrap max-md:text-base">
        {t("brand")}
      </Link>
      <div className="flex items-center gap-2 rounded-[20px] bg-white/10 px-4 py-2 font-sans text-[13px] font-semibold max-md:hidden">
        <ShieldCheck className="size-3.5" aria-hidden />
        {t("console")}
      </div>
      <div className="ms-auto flex items-center gap-3 max-md:gap-1">
        <Link href="/home" className="rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-white/80 hover:bg-white/10 hover:text-white">
          {t("backToApp")}
        </Link>
        <UserMenu user={user} isSuperAdmin />
      </div>
    </header>
  );
}

export function AdminNav() {
  return (
    <Suspense fallback={<Nav pathname="" />}>
      <RoutedNav />
    </Suspense>
  );
}

function RoutedNav() {
  return <Nav pathname={usePathname()} />;
}

function Nav({ pathname }: { pathname: string }) {
  const t = useTranslations("Shell.more");
  const tAdmin = useTranslations("Admin");
  return (
    <nav aria-label={tAdmin("console")} className="flex shrink-0 flex-wrap gap-1 border-b bg-background p-2 md:w-60 md:flex-col md:flex-nowrap md:border-e md:border-b-0 md:p-4">
      <p className="px-3 pb-3 text-base font-bold max-md:sr-only">{tAdmin("console")}</p>
      {adminItems.map(({ key, href, icon: Icon }) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted",
              active && "bg-accent font-semibold text-primary hover:bg-accent",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

export type Notice = { tone: "ok" | "error"; text: string } | null;

export function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg px-3 py-2 text-xs", notice.tone === "error" ? "bg-red-50 text-danger" : "bg-emerald-50 text-emerald-800")}
    >
      {notice.text}
    </p>
  );
}

export function StatusBadge({ tone, children }: { tone: "ok" | "warn" | "off" | "brand"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "ok" && "bg-emerald-50 text-emerald-800",
        tone === "warn" && "bg-amber-50 text-amber-700",
        tone === "off" && "bg-red-50 text-danger",
        tone === "brand" && "bg-accent text-primary",
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const selectClass = "h-10 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:border-ring";
export const filterSelectClass = "h-9 rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:border-ring";

export function StatTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-5">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[28px] leading-none font-bold tabular-nums">{value}</span>
      {detail && <span className={cn("text-xs text-muted-foreground", tone === "warn" && "font-semibold text-amber-700")}>{detail}</span>}
    </div>
  );
}

export function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border bg-background p-6", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Table({ head, children, minWidth = 760 }: { head: React.ReactNode; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-background">
      <table className="w-full text-[13px]" style={{ minWidth }}>
        <thead className="border-b bg-muted/60 text-[11px] font-semibold text-muted-foreground uppercase">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const th = "px-3 py-3 text-start first:ps-4 last:pe-4";
export const td = "px-3 py-3 first:ps-4 last:pe-4";
