import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AplusWorkspace } from "@/features/aplus/components/aplus-workspace";

export default async function AplusPage({ params }: PageProps<"/[locale]/aplus">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <AplusWorkspace />
    </Suspense>
  );
}
