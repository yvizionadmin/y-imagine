"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { signIn, signUp } from "../actions";

type Mode = "sign-in" | "sign-up";

/** Only same-app paths, so ?next= can't send people to another site. */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/home";
}

export function AuthForm({ mode, demo }: { mode: Mode; demo?: { email: string } }) {
  const t = useTranslations("Auth");
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const signingUp = mode === "sign-up";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    setBusy(true);
    setError(null);
    const response = signingUp
      ? await signUp({ name: value("name"), email: value("email"), password: value("password"), company: value("company") })
      : await signIn({ email: value("email"), password: value("password") });
    if (!response.ok) {
      setBusy(false);
      return setError(t(`errors.${response.error}`));
    }
    // Full navigation so the server shell re-reads the new session.
    window.location.assign(safeNext(params.get("next")));
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-[28px] leading-tight font-extrabold tracking-tight">{t(signingUp ? "signUpTitle" : "signInTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t(signingUp ? "signUpBody" : "signInBody")}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5" noValidate={false}>
        {signingUp && (
          <>
            <Field label={t("name")} htmlFor="auth-name">
              <Input id="auth-name" name="name" required maxLength={80} autoComplete="name" autoFocus className="h-11 text-sm" />
            </Field>
            <Field label={t("company")} htmlFor="auth-company" hint={t("companyHint")}>
              <Input id="auth-company" name="company" maxLength={80} autoComplete="organization" className="h-11 text-sm" />
            </Field>
          </>
        )}
        <Field label={t("email")} htmlFor="auth-email">
          <Input
            id="auth-email"
            name="email"
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            autoFocus={!signingUp}
            defaultValue={demo?.email ?? params.get("email") ?? undefined}
            placeholder="name@company.com"
            className="h-11 text-sm"
          />
        </Field>
        <Field label={t("password")} htmlFor="auth-password" hint={signingUp ? t("passwordHint") : undefined}>
          <div className="relative">
            <Input
              id="auth-password"
              name="password"
              type={show ? "text" : "password"}
              required
              minLength={signingUp ? 8 : undefined}
              maxLength={128}
              dir="ltr"
              autoComplete={signingUp ? "new-password" : "current-password"}
              className="h-11 pe-10 text-sm"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={t(show ? "hidePassword" : "showPassword")}
              aria-pressed={show}
              className="absolute end-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          {!signingUp && (
            <Link href="/forgot-password" className="self-end text-[12px] font-semibold text-primary hover:underline">
              {t("forgotLink")}
            </Link>
          )}
        </Field>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="h-11 text-sm font-bold">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t(signingUp ? "createAccount" : "signIn")}
        </Button>
      </form>

      {demo && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t("demoHint", { email: demo.email })}
        </p>
      )}

      <p className="text-center text-[13px] text-muted-foreground">
        {t(signingUp ? "haveAccount" : "noAccount")}{" "}
        <Link
          href={{ pathname: signingUp ? "/sign-in" : "/sign-up", query: params.get("next") ? { next: params.get("next")! } : {} }}
          className="font-semibold text-primary hover:underline"
        >
          {t(signingUp ? "signIn" : "signUp")}
        </Link>
      </p>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
