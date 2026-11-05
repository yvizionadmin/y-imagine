import { setRequestLocale } from "next-intl/server";
import { ResizeWorkspace } from "@/features/resize/components/resize-workspace";

export default async function ResizePage({ params }: PageProps<"/[locale]/resize">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ResizeWorkspace />;
}
