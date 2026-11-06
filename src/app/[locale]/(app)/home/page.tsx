import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { StudioHome } from "@/features/studio/components/studio-home";

export default async function HomePage({ params }: PageProps<"/[locale]/home">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <StudioHome />
    </Suspense>
  );
}
