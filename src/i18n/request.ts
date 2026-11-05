import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { ORG_TIME_ZONE } from "@/lib/time";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    // Org/user time zone setting comes with Clerk; Gulf default until then.
    timeZone: ORG_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
