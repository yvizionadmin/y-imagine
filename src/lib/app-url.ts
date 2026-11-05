import "server-only";
import { headers } from "next/headers";

/** Public base URL for links in emails and Stripe redirects: APP_URL, else the request's host. */
export async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}
