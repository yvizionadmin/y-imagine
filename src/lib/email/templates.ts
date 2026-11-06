import "server-only";
import { createTranslator } from "next-intl";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import type { EmailMessage } from "./send";

// Email bodies in the recipient's language (en, or ar right-to-left), from the `Emails` messages.
// One plain layout: heading, a few lines, one button, a quiet note. Every value is escaped.

export type EmailLocale = "en" | "ar";
const MESSAGES = { en, ar } as const;

export const emailLocale = (value: string | null | undefined): EmailLocale => (value === "ar" ? "ar" : "en");

export function emailTranslator(locale: EmailLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "Emails" });
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmail(input: {
  locale: EmailLocale;
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  /** A quoted block, e.g. a reviewer's note. */
  quote?: string;
  button: { label: string; url: string };
  note?: string;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const p = (text: string, style = "") => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#27272a;${style}">${escape(text)}</p>`;

  const html = `<!doctype html><html lang="${input.locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;text-align:${align}" dir="${dir}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;text-align:${align}">
<tr><td>
<p style="margin:0 0 24px;font-size:14px;font-weight:700;color:#7c5cff">Imagine AI</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0a0a0f">${escape(input.heading)}</h1>
${input.lines.map((line) => p(line)).join("\n")}
${input.quote ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-${dir === "rtl" ? "right" : "left"}:3px solid #d4d4d8;background:#fafafa;font-size:14px;line-height:1.6;color:#3f3f46">${escape(input.quote)}</blockquote>` : ""}
<p style="margin:24px 0"><a href="${escape(input.button.url)}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px">${escape(input.button.label)}</a></p>
${input.note ? p(input.note, "font-size:13px;color:#71717a") : ""}
</td></tr></table>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#a1a1aa;text-align:center">${escape(t("footer"))}</p>
</td></tr></table></body></html>`;

  const text = [input.heading, "", ...input.lines, ...(input.quote ? ["", `> ${input.quote}`] : []), "", `${input.button.label}: ${input.button.url}`, ...(input.note ? ["", input.note] : []), "", "—", t("footer")].join("\n");
  return { to: input.to, subject: input.subject, html, text };
}
