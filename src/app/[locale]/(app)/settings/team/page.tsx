import { setRequestLocale } from "next-intl/server";
import { TeamSettings } from "@/features/team/components/team-settings";

export default async function TeamPage({ params }: PageProps<"/[locale]/settings/team">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TeamSettings />;
}
