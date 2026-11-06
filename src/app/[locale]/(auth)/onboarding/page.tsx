import { Suspense } from "react";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { OnboardingForm } from "@/features/auth/components/onboarding-form";
import { getSession, signedOutPath } from "@/lib/auth/session";
import { getPlatformSettings } from "@/lib/platform/settings";
import { listMembershipsForUser } from "@/lib/team/members";

export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

async function Onboarding() {
  const session = await getSession();
  if (!session) redirect(await signedOutPath());
  // Invited people (and anyone who already has a workspace) go straight in.
  if ((await listMembershipsForUser(session.user.id)).length) redirect("/home");
  const { signupsEnabled } = await getPlatformSettings();
  return <OnboardingForm email={session.user.email} signupsOpen={signupsEnabled} />;
}
