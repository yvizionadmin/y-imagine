import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/features/auth/components/auth-form";
import { ClerkAuth } from "@/features/auth/components/clerk";
import { clerkEnabled } from "@/lib/auth/constants";
import { DEMO_EMAIL } from "@/lib/auth/demo";

export default async function SignInPage({ params }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?next=) is request data.
    <Suspense>
      {clerkEnabled() ? (
        <ClerkAuth mode="sign-in" />
      ) : (
        <AuthForm mode="sign-in" demo={process.env.IMAGINE_DEMO === "1" ? { email: DEMO_EMAIL } : undefined} />
      )}
    </Suspense>
  );
}
