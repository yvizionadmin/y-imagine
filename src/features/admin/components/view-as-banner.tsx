"use client";

import { Suspense, useEffect, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LATN } from "@/lib/format";
import { stopViewAs } from "../actions";

/** Always on screen while a super admin views an org: whose data this is, that nothing can change, and the way out. */
export function ViewAsBanner({ orgName, expiresAt }: { orgName: string; expiresAt: string }) {
  const t = useTranslations("ViewAs");
  const format = useFormatter();
  const [leaving, leave] = useTransition();

  // The cookie is gone at this point, so reloading drops out of the view rather than leaving a stale banner up.
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), new Date(expiresAt).getTime() - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 font-sans text-amber-900">
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-semibold">
        <Eye className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {t("banner", { org: orgName, time: format.dateTime(new Date(expiresAt), { ...LATN, hour: "numeric", minute: "2-digit" }) })}
        </span>
        <Button size="sm" variant="outline" disabled={leaving} onClick={() => leave(() => stopViewAs())} className="font-semibold">
          {leaving && <Loader2 className="animate-spin" aria-hidden />}
          {t("exit")}
        </Button>
      </div>
      <Suspense>
        <RefusedNotice />
      </Suspense>
    </div>
  );
}

function RefusedNotice() {
  const t = useTranslations("ViewAs");
  if (!useSearchParams().has("readOnly")) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium">
      {t("refused")}
    </p>
  );
}
