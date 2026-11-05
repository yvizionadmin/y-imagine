import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { GenerateWorkspace } from "@/features/generate/components/generate-workspace";

export default async function GeneratePage({ params }: PageProps<"/[locale]/generate">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <GenerateWorkspace />
    </Suspense>
  );
}
