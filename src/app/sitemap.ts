import type { MetadataRoute } from "next";
import { LEGAL_DETAILS } from "@/features/marketing/legal-details";
import { marketingPaths, siteUrl } from "@/features/marketing/metadata";
import { routing } from "@/i18n/routing";

// The public pages in every language. Legal pages join once they are reviewed (they are noindex until then).
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = marketingPaths.filter((p) => LEGAL_DETAILS.reviewed || (p !== "/terms" && p !== "/privacy"));
  return paths.map((path) => ({
    url: `${siteUrl()}/${routing.defaultLocale}${path}`,
    alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `${siteUrl()}/${l}${path}`])) },
  }));
}
