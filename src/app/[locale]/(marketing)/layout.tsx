import { setRequestLocale } from "next-intl/server";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";

export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Server translations in the shell read the locale from here; otherwise they'd need request headers and lose static rendering.
  setRequestLocale((await params).locale);
  return <MarketingShell>{children}</MarketingShell>;
}
