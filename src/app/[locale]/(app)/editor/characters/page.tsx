import { setRequestLocale } from "next-intl/server";
import { CharactersWorkspace } from "@/features/characters/components/characters-workspace";

// Saved characters (B13), under the video editor next to the AI Director that uses them.
export default async function CharactersPage({ params }: PageProps<"/[locale]/editor/characters">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CharactersWorkspace />;
}
