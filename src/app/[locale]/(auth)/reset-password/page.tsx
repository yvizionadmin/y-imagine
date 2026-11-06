import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { setRequestLocale } from "next-intl/server";
import { ResetPasswordForm } from "@/features/auth/components/password-reset-forms";
import { clerkEnabled } from "@/lib/auth/constants";
import { resetTokenValid } from "@/lib/auth/password-reset";

export default async function ResetPasswordPage({ params, searchParams }: PageProps<"/[locale]/reset-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (clerkEnabled()) redirect(`/${locale}/sign-in`);
  return (
    // The token is request data, checked against the database at request time.
    <Suspense>
      <ResetPassword searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetPassword({ searchParams }: { searchParams: PageProps<"/[locale]/reset-password">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  return <ResetPasswordForm token={token} valid={await resetTokenValid(token)} />;
}
