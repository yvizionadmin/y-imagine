import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { RecolorWorkspace } from "@/features/recolor/components/recolor-workspace";

export default async function RecolorPage({ params }: PageProps<"/[locale]/recolor">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <RecolorWorkspace />
    </Suspense>
  );
}
