"use client";

import { createContext, useContext } from "react";
import { SignIn, SignUp, useClerk } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { signOut as localSignOut } from "../actions";

// Clerk's side of sign-in. Only rendered under <ClerkProvider> (layout, when Clerk keys are set).

const SignOutContext = createContext<() => Promise<void>>(localSignOut);

/** Signs out through whichever login is active: Clerk's client (clears its cookies) or the local session. */
export const useSignOut = () => useContext(SignOutContext);

export function ClerkSignOutProvider({ children }: { children: React.ReactNode }) {
  const clerk = useClerk();
  const locale = useLocale();
  return <SignOutContext value={() => clerk.signOut({ redirectUrl: `/${locale}/sign-in` })}>{children}</SignOutContext>;
}

/** Same-origin path from ?next= (set by the proxy), else the first tool. */
function useNext() {
  const locale = useLocale();
  const next = useSearchParams().get("next");
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : `/${locale}/generate`;
}

export function ClerkAuth({ mode }: { mode: "sign-in" | "sign-up" }) {
  const locale = useLocale();
  const next = useNext();
  return mode === "sign-in" ? (
    <SignIn routing="hash" signUpUrl={`/${locale}/sign-up`} fallbackRedirectUrl={next} signUpFallbackRedirectUrl={`/${locale}/onboarding`} />
  ) : (
    <SignUp routing="hash" signInUrl={`/${locale}/sign-in`} fallbackRedirectUrl={`/${locale}/onboarding`} signInFallbackRedirectUrl={next} />
  );
}
