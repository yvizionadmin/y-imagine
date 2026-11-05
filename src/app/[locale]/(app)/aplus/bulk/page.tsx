import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BulkAplusWorkspace } from "@/features/aplus/components/bulk-aplus-workspace";

export default async function BulkAplusPage({ params }: PageProps<"/[locale]/aplus/bulk">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // Same boundary as the other bulk pages: without it, Cache Components' dev check reloads the page in a loop.
    <Suspense>
      <BulkAplusWorkspace />
    </Suspense>
  );
}
