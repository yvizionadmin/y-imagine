import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { TemplateExplorer } from "@/features/templates/components/template-explorer";

export default async function TemplatesPage({ params }: PageProps<"/[locale]/templates">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <TemplateExplorer />
    </Suspense>
  );
}
