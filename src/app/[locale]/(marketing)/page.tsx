import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { HomePage } from "@/features/marketing/components/home-page";
import { marketingMetadata } from "@/features/marketing/metadata";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  return marketingMetadata((await params).locale, "home");
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  setRequestLocale((await params).locale);
  return <HomePage />;
}
