"use client";

import { useState, useTransition } from "react";
import { Building2, Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createCompany } from "../actions";
import { useSignOut } from "./clerk";

/** Second sign-up step with Clerk: Clerk's form has no company field, so the workspace is named here. */
export function OnboardingForm({ email, signupsOpen }: { email: string; signupsOpen: boolean }) {
  const t = useTranslations("Auth");
  const signOut = useSignOut();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, startSignOut] = useTransition();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const response = await createCompany({ company: String(new FormData(e.currentTarget).get("company") ?? "") });
    if (!response.ok) {
      setBusy(false);
      return setError(t(`errors.${response.error}`));
    }
    router.replace("/home");
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
          <Building2 className="size-6" aria-hidden />
        </span>
        <h2 className="text-[28px] leading-tight font-extrabold tracking-tight">{t(signupsOpen ? "onboarding.title" : "blocked.no_org.title")}</h2>
        <p className="text-sm text-muted-foreground">{signupsOpen ? t("onboarding.body") : t("errors.signups_closed")}</p>
      </div>

      {signupsOpen && (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="onboarding-company" className="text-[13px] font-semibold">
              {t("company")}
            </label>
            <Input id="onboarding-company" name="company" required maxLength={80} autoComplete="organization" autoFocus className="h-11 text-sm" />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="h-11 text-sm font-bold">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("onboarding.submit")}
          </Button>
        </form>
      )}

      <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-[13px] text-muted-foreground">
        <span>{t("onboarding.signedInAs", { email })}</span>
        <button
          type="button"
          onClick={() => startSignOut(() => signOut())}
          disabled={signingOut}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          <LogOut className="size-3.5 rtl:-scale-x-100" aria-hidden />
          {t("onboarding.switchAccount")}
        </button>
      </p>
    </div>
  );
}
