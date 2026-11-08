import type { ReactNode } from "react";

/** The heading of a non-tool page (History, Analytics…), so they all share one size and spacing. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
