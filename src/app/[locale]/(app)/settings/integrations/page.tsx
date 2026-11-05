import { setRequestLocale } from "next-intl/server";
import { IntegrationsSettings } from "@/features/integrations/components/integrations-settings";

export default async function IntegrationsPage({ params }: PageProps<"/[locale]/settings/integrations">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <IntegrationsSettings />;
}
