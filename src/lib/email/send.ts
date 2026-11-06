import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportError } from "@/lib/observability/report";

// Transactional email. The transport comes from the environment, never from code:
//   RESEND_API_KEY → Resend's HTTP API;  SMTP_URL → any SMTP server (smtps://user:pass@host:465);
//   neither → written to EMAIL_OUTBOX_DIR (default .data/outbox) outside production, or in production
//   only when EMAIL_OUTBOX_DIR is set explicitly (end-to-end tests on the production build).
// EMAIL_FROM is the sender ("Imagine AI <no-reply@example.com>"). Sending never throws: an email is
// a notice, the action that triggered it has already happened.

export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type EmailResult = "sent" | "outbox" | "skipped" | "failed";

const TIMEOUT_MS = 10_000;

export type EmailTransport = "resend" | "smtp" | "outbox" | null;

export function emailTransport(): EmailTransport {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_URL) return "smtp";
  return process.env.NODE_ENV !== "production" || process.env.EMAIL_OUTBOX_DIR ? "outbox" : null;
}

/** Whether emails reach people (a real transport, or the local outbox in development). */
export const emailEnabled = () => emailTransport() !== null;

const sender = () => process.env.EMAIL_FROM || "Imagine AI <no-reply@localhost>";

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const transport = emailTransport();
  if (!transport) return "skipped";
  try {
    if (transport === "resend") await viaResend(message);
    else if (transport === "smtp") await viaSmtp(message);
    else {
      await toOutbox(message);
      return "outbox";
    }
    return "sent";
  } catch (error) {
    // No addresses or content in the report: the transport and the error kind are enough.
    reportError("email failed", error, { transport });
    return "failed";
  }
}

async function viaResend(message: EmailMessage) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: sender(), to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`resend ${response.status}`);
}

let smtp: import("nodemailer").Transporter | null = null;

async function viaSmtp(message: EmailMessage) {
  if (!smtp) {
    const nodemailer = await import("nodemailer");
    const url = new URL(process.env.SMTP_URL!);
    smtp = nodemailer.createTransport({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === "smtps:" ? 465 : 587),
      secure: url.protocol === "smtps:",
      auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
      connectionTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  await smtp.sendMail({ from: sender(), ...message });
}

async function toOutbox(message: EmailMessage) {
  const dir = path.resolve(process.env.EMAIL_OUTBOX_DIR || ".data/outbox");
  await mkdir(dir, { recursive: true });
  const slug = message.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "email";
  await writeFile(path.join(dir, `${Date.now()}-${slug}.json`), JSON.stringify({ from: sender(), ...message }, null, 2));
}
