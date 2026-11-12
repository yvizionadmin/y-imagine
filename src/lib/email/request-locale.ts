import "server-only";
import { getLocale } from "next-intl/server";
import { emailLocale, type EmailLocale } from "./templates";

// Kept apart from notify.ts: next-intl/server needs the Next request runtime, and the worker
// (which sends notices through notify.ts) cannot load it.

/** The current request's language for emails (en outside a request, where getLocale throws). */
export async function requestEmailLocale(): Promise<EmailLocale> {
  try {
    return emailLocale(await getLocale());
  } catch {
    return "en";
  }
}
