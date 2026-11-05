import { setRequestLocale } from "next-intl/server";
import { AdminOrganizations } from "@/features/admin/components/admin-organizations";

export default async function Page({ params }: PageProps<"/[locale]/admin/organizations">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminOrganizations />;
}
