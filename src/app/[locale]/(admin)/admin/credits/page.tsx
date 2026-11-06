import { setRequestLocale } from "next-intl/server";
import { AdminCredits } from "@/features/admin/components/admin-credits";

export default async function Page({ params }: PageProps<"/[locale]/admin/credits">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminCredits />;
}
