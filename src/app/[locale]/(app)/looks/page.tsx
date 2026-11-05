import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { LooksBuilder } from "@/features/looks/components/builder";

export default async function Page({ params }: PageProps<"/[locale]/looks">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <LooksBuilder />
    </Suspense>
  );
}
