import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { DirectorWorkspace } from "@/features/director/components/director-workspace";

// AI Director (B11), under the video editor: its finished videos are editor projects.
export default async function DirectorPage({ params }: PageProps<"/[locale]/editor/director">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?project=) is request data.
    <Suspense>
      <DirectorWorkspace />
    </Suspense>
  );
}
