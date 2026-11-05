import { setRequestLocale } from "next-intl/server";
import { LooksHistory } from "@/features/looks/components/look-history";

export default async function Page({ params }: PageProps<"/[locale]/looks/history">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LooksHistory />;
}
