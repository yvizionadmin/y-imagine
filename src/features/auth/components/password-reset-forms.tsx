"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset, resetPassword } from "../actions";

// Local-login password reset: ask for a link by email, then choose a new password from it.

function Header({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[28px] leading-tight font-extrabold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function BackToSignIn() {
  const t = useTranslations("Auth");
  return (
    <p className="text-center text-[13px]">
      <Link href="/sign-in" className="font-semibold text-primary hover:underline">
        {t("backToSignIn")}
      </Link>
    </p>
  );
}

const Alert = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
    {children}
  </p>
);

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    const response = await requestPasswordReset({ email });
    setBusy(false);
    if (!response.ok) return setError(t(`errors.${response.error}`));
    setSentTo(email);
  }

  return (
    <div className="flex flex-col gap-8">
      <Header title={t("forgotTitle")} body={t("forgotBody")} />
      {sentTo ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          {t("forgotSent", { email: sentTo })}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-email" className="text-[13px] font-semibold">
              {t("email")}
            </label>
            <Input id="reset-email" name="email" type="email" required dir="ltr" autoComplete="email" autoFocus placeholder="name@company.com" className="h-11 text-sm" />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy} className="h-11 text-sm font-bold">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("sendLink")}
          </Button>
        </form>
      )}
      <BackToSignIn />
    </div>
  );
}

export function ResetPasswordForm({ token, valid }: { token: string; valid: boolean }) {
  const t = useTranslations("Auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(valid ? null : t("errors.invalid_token"));
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const response = await resetPassword({ token, password });
    setBusy(false);
    if (!response.ok) return setError(t(`errors.${response.error}`));
    setDone(true);
  }

  return (
    <div className="flex flex-col gap-8">
      <Header title={t("resetTitle")} body={t("resetBody")} />
      {done ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          {t("resetDone")}
        </p>
      ) : valid ? (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-password" className="text-[13px] font-semibold">
              {t("newPassword")}
            </label>
            <Input id="reset-password" name="password" type="password" required minLength={8} maxLength={128} dir="ltr" autoComplete="new-password" autoFocus className="h-11 text-sm" />
            <p className="text-[11px] text-muted-foreground">{t("passwordHint")}</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy} className="h-11 text-sm font-bold">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("savePassword")}
          </Button>
        </form>
      ) : (
        <>
          {error && <Alert>{error}</Alert>}
          <p className="text-center text-[13px]">
            <Link href="/forgot-password" className="font-semibold text-primary hover:underline">
              {t("forgotLink")}
            </Link>
          </p>
        </>
      )}
      <BackToSignIn />
    </div>
  );
}
