import { setRequestLocale } from "next-intl/server";
import { LooksGallery } from "@/features/looks/components/gallery";

export default async function Page({ params }: PageProps<"/[locale]/looks/boards">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LooksGallery />;
}
