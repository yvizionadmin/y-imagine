import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { CopyWorkspace } from "@/features/copy/components/copy-workspace";

export default async function CopyPage({ params }: PageProps<"/[locale]/copy">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?sku= from History) is request data.
    <Suspense>
      <CopyWorkspace />
    </Suspense>
  );
}
