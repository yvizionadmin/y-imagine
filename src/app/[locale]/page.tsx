import { redirect } from "@/i18n/navigation";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  redirect({ href: "/home", locale });
}
