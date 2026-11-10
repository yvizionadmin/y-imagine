import { setRequestLocale } from "next-intl/server";
import { ProductTypesSettings } from "@/features/product-types/components/product-types-settings";

export default async function ProductTypesPage({ params }: PageProps<"/[locale]/settings/product-types">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProductTypesSettings />;
}
