import { setRequestLocale } from "next-intl/server";
import { ProviderKeysSettings } from "@/features/ai-providers/components/provider-keys-settings";

export default async function ApiKeysPage({ params }: PageProps<"/[locale]/settings/api-keys">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProviderKeysSettings />;
}
