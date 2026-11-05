import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { MoodBoardDetail } from "@/features/looks/components/mood-board-detail";

// The board id is only known at request time, so params are read inside Suspense to keep the
// app shell prerendered (Cache Components).
export default function Page({ params }: PageProps<"/[locale]/looks/boards/[id]">) {
  return (
    <Suspense>
      <Board params={params} />
    </Suspense>
  );
}

async function Board({ params }: { params: PageProps<"/[locale]/looks/boards/[id]">["params"] }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <MoodBoardDetail id={id} />;
}
