import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FeaturesPage } from "@/features/marketing/components/features-page";
import { marketingMetadata, marketingPath, siteUrl } from "@/features/marketing/metadata";
import { breadcrumbs, JsonLd } from "@/features/marketing/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/features">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "features");
}

export default async function Features({ params }: PageProps<"/[locale]/features">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Marketing.nav");
  return (
    <>
      <JsonLd
        data={breadcrumbs(siteUrl(), [
          { name: t("home"), path: marketingPath(locale, "home") },
          { name: t("features"), path: marketingPath(locale, "features") },
        ])}
      />
      <FeaturesPage />
    </>
  );
}
