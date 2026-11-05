import { setRequestLocale } from "next-intl/server";
import { AdminActivity } from "@/features/admin/components/admin-activity";

export default async function Page({ params }: PageProps<"/[locale]/admin/activity">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminActivity />;
}
