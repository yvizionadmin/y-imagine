import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/features/auth/components/auth-form";
import { ClerkAuth } from "@/features/auth/components/clerk";
import { clerkEnabled } from "@/lib/auth/constants";

export default async function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      {clerkEnabled() ? <ClerkAuth mode="sign-up" /> : <AuthForm mode="sign-up" />}
    </Suspense>
  );
}
