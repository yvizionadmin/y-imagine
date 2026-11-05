import { setRequestLocale } from "next-intl/server";
import { RoomBackgroundsManager } from "@/features/looks/components/room-backgrounds";

export default async function Page({ params }: PageProps<"/[locale]/looks/backgrounds">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RoomBackgroundsManager />;
}
