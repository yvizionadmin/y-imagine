import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomePage } from "@/features/marketing/components/home-page";
import { LEGAL_DETAILS } from "@/features/marketing/legal-details";
import { marketingMetadata, siteUrl } from "@/features/marketing/metadata";
import { homeGraph, JsonLd } from "@/features/marketing/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "home");
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Marketing");
  return (
    <>
      <JsonLd data={homeGraph({ base: siteUrl(), locale, brand: t("brand"), description: t("meta.home.description"), email: LEGAL_DETAILS.contactEmail })} />
      <HomePage />
    </>
  );
}
