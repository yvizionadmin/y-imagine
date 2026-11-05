import { Suspense } from "react";
import { connection } from "next/server";
import { setRequestLocale } from "next-intl/server";
import { BlockedNotice } from "@/features/auth/components/blocked-notice";
import { getPlatformSettings } from "@/lib/platform/settings";

export default async function BlockedPage({ params }: PageProps<"/[locale]/blocked">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <MaintenanceAware />
    </Suspense>
  );
}

async function MaintenanceAware() {
  await connection();
  const { maintenance } = await getPlatformSettings();
  return <BlockedNotice maintenanceMessage={maintenance.enabled ? maintenance.message : ""} />;
}
