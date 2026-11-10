import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { EditorWorkspace } from "@/features/editor/components/editor-workspace";

export default async function EditorPage({ params }: PageProps<"/[locale]/editor">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The workspace reads ?project= / ?clip= (useSearchParams), so it renders on the client.
  return (
    <Suspense>
      <EditorWorkspace />
    </Suspense>
  );
}
