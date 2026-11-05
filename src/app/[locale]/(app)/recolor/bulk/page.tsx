import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BulkRecolorWorkspace } from "@/features/recolor/components/bulk-recolor-workspace";

export default async function BulkRecolorPage({ params }: PageProps<"/[locale]/recolor/bulk">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // Same boundary as the other bulk pages: without it, Cache Components' dev check reloads the page in a loop.
    <Suspense>
      <BulkRecolorWorkspace />
    </Suspense>
  );
}
