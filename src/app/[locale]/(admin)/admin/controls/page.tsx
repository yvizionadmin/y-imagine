import { setRequestLocale } from "next-intl/server";
import { AdminControls } from "@/features/admin/components/admin-controls";

export default async function Page({ params }: PageProps<"/[locale]/admin/controls">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminControls />;
}
