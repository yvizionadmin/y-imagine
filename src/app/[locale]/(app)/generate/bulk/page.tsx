import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BulkGenerateWorkspace } from "@/features/generate/components/bulk-generate-workspace";

export default async function BulkGeneratePage({ params }: PageProps<"/[locale]/generate/bulk">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // Same boundary as /copy/bulk: without it, Cache Components' dev check reloads this page in a loop.
    <Suspense>
      <BulkGenerateWorkspace />
    </Suspense>
  );
}
