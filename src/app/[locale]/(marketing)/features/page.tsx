import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { FeaturesPage } from "@/features/marketing/components/features-page";
import { marketingMetadata } from "@/features/marketing/metadata";

export async function generateMetadata({ params }: PageProps<"/[locale]/features">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "features");
}

export default async function Features({ params }: PageProps<"/[locale]/features">) {
  setRequestLocale((await params).locale);
  return <FeaturesPage />;
}
