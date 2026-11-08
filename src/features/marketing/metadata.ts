import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

export type MarketingPage = "home" | "features" | "pricing" | "terms" | "privacy";

const PATH: Record<MarketingPage, string> = { home: "", features: "/features", pricing: "/pricing", terms: "/terms", privacy: "/privacy" };

/** Public base URL; APP_URL is set on every deployed service. */
export const siteUrl = () => (process.env.APP_URL || "http://localhost:3100").replace(/\/$/, "");
export const marketingPaths = Object.values(PATH);

/** Title, description, language alternates and share card for one public page. */
export async function marketingMetadata(locale: string, page: MarketingPage, options: { noindex?: boolean } = {}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Marketing.meta" });
  const tm = await getTranslations({ locale, namespace: "Marketing" });
  const title = page === "home" ? t("home.title") : `${t(`${page}.title`)} · ${tm("brand")}`;
  const description = t(`${page}.description`);
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    alternates: {
      canonical: `/${locale}${PATH[page]}`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}${PATH[page]}`])),
    },
    openGraph: { title, description, type: "website", siteName: tm("brand"), images: ["/demo/lifestyle-living-room.png"] },
    robots: options.noindex ? { index: false, follow: true } : undefined,
  };
}
