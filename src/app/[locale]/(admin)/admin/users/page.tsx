import { setRequestLocale } from "next-intl/server";
import { AdminUsers } from "@/features/admin/components/admin-users";

export default async function Page({ params }: PageProps<"/[locale]/admin/users">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminUsers />;
}
