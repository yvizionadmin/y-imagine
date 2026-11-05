import { setRequestLocale } from "next-intl/server";
import { LinksWorkspace } from "@/features/links/components/links-workspace";

export default async function LinksPage({ params }: PageProps<"/[locale]/links">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LinksWorkspace />;
}
