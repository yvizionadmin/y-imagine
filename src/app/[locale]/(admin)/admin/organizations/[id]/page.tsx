import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AdminOrgDetail } from "@/features/admin/components/admin-org-detail";

// The org id is only known at request time, so params are read inside Suspense (Cache Components).
export default function Page({ params }: PageProps<"/[locale]/admin/organizations/[id]">) {
  return (
    <Suspense>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/[locale]/admin/organizations/[id]">["params"] }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <AdminOrgDetail id={id} />;
}
