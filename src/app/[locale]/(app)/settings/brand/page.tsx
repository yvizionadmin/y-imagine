import { setRequestLocale } from "next-intl/server";
import { BrandKitSettings } from "@/features/brand/components/brand-kit-settings";

export default async function BrandKitPage({ params }: PageProps<"/[locale]/settings/brand">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BrandKitSettings />;
}
