import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/features/marketing/components/legal-page";
import { LEGAL_DETAILS } from "@/features/marketing/legal-details";
import { marketingMetadata } from "@/features/marketing/metadata";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "terms", { noindex: !LEGAL_DETAILS.reviewed });
}

export default async function Page({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage kind="terms" locale={locale as Locale} />;
}
