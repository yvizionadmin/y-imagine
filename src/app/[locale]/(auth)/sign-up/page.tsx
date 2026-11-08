import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/features/auth/components/auth-form";
import { ClerkAuth } from "@/features/auth/components/clerk";
import { Link } from "@/i18n/navigation";
import { clerkEnabled } from "@/lib/auth/constants";

export default async function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const linkClass = "font-medium underline underline-offset-2 hover:text-foreground";
  return (
    <>
      <Suspense>
        {clerkEnabled() ? <ClerkAuth mode="sign-up" /> : <AuthForm mode="sign-up" />}
      </Suspense>
      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        {t.rich("agreeLegal", {
          terms: (chunks) => (
            <Link href="/terms" className={linkClass}>
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className={linkClass}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </>
  );
}
