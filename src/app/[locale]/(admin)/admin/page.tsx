import { setRequestLocale } from "next-intl/server";
import { AdminOverview } from "@/features/admin/components/admin-overview";

export default async function Page({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminOverview />;
}
