"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";
import { useLocalFlag } from "@/lib/local-flag";
import type { SetupStep } from "@/lib/onboarding";
import { getSetupChecklist, type SetupState } from "../actions";

const STEPS: { step: SetupStep; href: `/${string}` | null; adminOnly: boolean }[] = [
  { step: "key", href: "/settings/api-keys", adminOnly: true },
  { step: "image", href: null, adminOnly: false },
  { step: "store", href: "/settings/integrations", adminOnly: true },
  { step: "team", href: "/settings/team", adminOnly: true },
];

/**
 * Home's first-run checklist (U6): connect an AI key, make a first image, connect a store, invite the team.
 * Hidden once every step is done, or when dismissed (remembered in this browser).
 */
export function SetupChecklist() {
  const t = useTranslations("Studio.setup");
  const [state, setState] = useState<SetupState | null>(null);
  const [dismissed, dismiss] = useLocalFlag(state ? `imagine.setup-dismissed.${state.orgId}` : null);

  useEffect(() => {
    void getSetupChecklist().then(setState, () => {});
  }, []);

  if (!state || dismissed) return null;
  const done = STEPS.filter((s) => state.steps[s.step]).length;
  if (done === STEPS.length) return null;

  return (
    <section aria-labelledby="setup-title" className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-8">
      <div className="flex flex-col gap-3 rounded-2xl border bg-background p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="setup-title" className="text-sm font-bold">
              {t("title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("progress", { done, total: STEPS.length })}</p>
          </div>
          <button type="button" onClick={dismiss} aria-label={t("dismiss")} title={t("dismiss")} className="rounded-full p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / STEPS.length) * 100}%` }} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ step, href, adminOnly }, i) => {
            const complete = state.steps[step];
            const blocked = adminOnly && !state.isAdmin;
            return (
              <li key={step} className={cn("flex gap-3 rounded-xl border p-3", complete && "bg-muted/50")}>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    complete ? "bg-emerald-600 text-white" : "border text-muted-foreground",
                  )}
                >
                  {complete ? <Check className="size-3.5" aria-label={t("done")} /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className={cn("text-[13px] font-semibold", complete && "text-muted-foreground line-through")}>{t(`steps.${step}.title`)}</span>
                  <span className="text-[11px] text-muted-foreground">{t(`steps.${step}.body`)}</span>
                  {!complete &&
                    (blocked ? (
                      <span className="text-[11px] font-medium text-muted-foreground">{t("askAdmin")}</span>
                    ) : href ? (
                      <Link href={href} className="w-fit text-xs font-semibold text-primary hover:underline">
                        {t(`steps.${step}.action`)}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => document.getElementById("studio-prompt")?.focus()}
                        className="w-fit text-xs font-semibold text-primary hover:underline"
                      >
                        {t(`steps.${step}.action`)}
                      </button>
                    ))}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
