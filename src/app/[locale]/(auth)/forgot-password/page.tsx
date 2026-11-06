import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ForgotPasswordForm } from "@/features/auth/components/password-reset-forms";
import { clerkEnabled } from "@/lib/auth/constants";

// Local login only: with Clerk, its sign-in screen has its own "Forgot password?".
export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (clerkEnabled()) redirect(`/${locale}/sign-in`);
  return <ForgotPasswordForm />;
}
