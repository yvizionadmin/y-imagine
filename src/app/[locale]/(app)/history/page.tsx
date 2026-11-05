import { setRequestLocale } from "next-intl/server";
import { HistoryView } from "@/features/history/components/history-view";

export default async function HistoryPage({ params }: PageProps<"/[locale]/history">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <HistoryView />
    </div>
  );
}
