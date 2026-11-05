import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BulkCopyWorkspace } from "@/features/copy/components/bulk-copy-workspace";

export default async function BulkCopyPage({ params }: PageProps<"/[locale]/copy/bulk">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // Same boundary as /copy: without it, Cache Components' dev check reloads this page in a loop.
    <Suspense>
      <BulkCopyWorkspace />
    </Suspense>
  );
}
