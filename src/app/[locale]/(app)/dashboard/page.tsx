import { setRequestLocale } from "next-intl/server";
import { AnalyticsDashboard } from "@/features/analytics/components/analytics-dashboard";

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AnalyticsDashboard />;
}
