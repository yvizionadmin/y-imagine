import { Instrument_Serif } from "next/font/google";
import { setRequestLocale } from "next-intl/server";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import "@/features/marketing/marketing.css";

// Display serif for the italic accents on the public site only.
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: "italic" });

export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Server translations in the shell read the locale from here; otherwise they'd need request headers and lose static rendering.
  setRequestLocale((await params).locale);
  return <MarketingShell className={instrument.variable}>{children}</MarketingShell>;
}
