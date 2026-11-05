import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

const rtlLocales: ReadonlySet<Locale> = new Set(["ar"]);

export function getDirection(locale: Locale): "ltr" | "rtl" {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}
