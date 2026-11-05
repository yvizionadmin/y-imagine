import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { QrWorkspace } from "@/features/qr/components/qr-workspace";

// The workspace reads ?url= (prefilled from Links), so it renders under Suspense.
export default async function QrPage({ params }: PageProps<"/[locale]/qr">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <QrWorkspace />
    </Suspense>
  );
}
