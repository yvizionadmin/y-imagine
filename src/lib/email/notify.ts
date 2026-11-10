import "server-only";
import { getLocale } from "next-intl/server";
import { appUrl } from "@/lib/app-url";
import { LATN } from "@/lib/format";
import { reportError } from "@/lib/observability/report";
import { listMembers } from "@/lib/team/members";
import { sendEmail, type EmailResult } from "./send";
import { emailLocale, emailTranslator, renderEmail, type EmailLocale } from "./templates";

// The emails the app sends, one function each. Callers pass the language of the person acting
// (their current locale); links point into this deployment (APP_URL, else the request host).

type Role = "admin" | "editor" | "viewer";

/** Invitation to a workspace: a sign-up link for new people, a sign-in link when they already have an account. */
export async function sendInviteEmail(input: { to: string; orgName: string; inviter: string; role: Role; hasAccount: boolean; locale: EmailLocale }): Promise<EmailResult> {
  const t = emailTranslator(input.locale);
  const base = `${await appUrl()}/${input.locale}`;
  const url = input.hasAccount ? `${base}/sign-in` : `${base}/sign-up?email=${encodeURIComponent(input.to)}`;
  const vars = { org: input.orgName, inviter: input.inviter, role: t(`roles.${input.role}`) };
  return sendEmail(
    renderEmail({
      locale: input.locale,
      to: input.to,
      subject: t("invite.subject", vars),
      heading: t("invite.heading", vars),
      lines: [t("invite.body", vars), t(input.hasAccount ? "invite.existing" : "invite.new")],
      button: { label: t(input.hasAccount ? "invite.signIn" : "invite.accept"), url },
      note: t("invite.note"),
    }),
  );
}

export async function sendPasswordResetEmail(input: { to: string; token: string; locale: EmailLocale }): Promise<EmailResult> {
  const t = emailTranslator(input.locale);
  const url = `${await appUrl()}/${input.locale}/reset-password?token=${encodeURIComponent(input.token)}`;
  return sendEmail(
    renderEmail({
      locale: input.locale,
      to: input.to,
      subject: t("reset.subject"),
      heading: t("reset.heading"),
      lines: [t("reset.body")],
      button: { label: t("reset.button"), url },
      note: t("reset.note"),
    }),
  );
}

/** Images sent for review: every active admin of the org except the person who sent them. */
export async function notifyImagesSubmitted(input: { orgId: string; orgName: string; actorId: string; actor: string; count: number; label: string; locale: EmailLocale }) {
  const t = emailTranslator(input.locale);
  const url = `${await appUrl()}/${input.locale}/history`;
  const admins = (await listMembers({ orgId: input.orgId })).filter((m) => m.role === "admin" && m.status === "active" && m.userId !== input.actorId);
  const vars = { actor: input.actor, count: input.count, label: input.label, org: input.orgName };
  for (const admin of admins) {
    await sendEmail(
      renderEmail({
        locale: input.locale,
        to: admin.email,
        subject: t("imageSubmitted.subject", vars),
        heading: t("imageSubmitted.heading", vars),
        lines: [t("imageSubmitted.body", vars)],
        button: { label: t("imageSubmitted.button"), url },
        note: t("noticeNote", { org: input.orgName }),
      }),
    );
  }
  return admins.length;
}

/** Approval or a change request, to the person who made the images (not when they reviewed them themselves). */
export async function notifyImagesReviewed(input: {
  orgId: string;
  orgName: string;
  authorId: string | null;
  actorId: string;
  actor: string;
  outcome: "approved" | "changes_requested";
  label: string;
  count: number;
  note: string | null;
  locale: EmailLocale;
}) {
  if (!input.authorId || input.authorId === input.actorId) return 0;
  const author = (await listMembers({ orgId: input.orgId })).find((m) => m.userId === input.authorId && m.status === "active");
  if (!author) return 0;
  const t = emailTranslator(input.locale);
  const key = input.outcome === "approved" ? "imageApproved" : "imageChanges";
  const vars = { actor: input.actor, label: input.label, count: input.count, org: input.orgName };
  await sendEmail(
    renderEmail({
      locale: input.locale,
      to: author.email,
      subject: t(`${key}.subject`, vars),
      heading: t(`${key}.heading`, vars),
      lines: [t(`${key}.body`, vars)],
      quote: input.note ?? undefined,
      button: { label: t("imageOpen"), url: `${await appUrl()}/${input.locale}/history` },
      note: t("noticeNote", { org: input.orgName }),
    }),
  );
  return 1;
}

/** Copy sent for review: every active admin of the org except the person who sent it. */
export async function notifyCopySubmitted(input: { orgId: string; orgName: string; actorId: string; actor: string; count: number; label: string; locale: EmailLocale }) {
  const t = emailTranslator(input.locale);
  const url = `${await appUrl()}/${input.locale}/copy`;
  const admins = (await listMembers({ orgId: input.orgId })).filter((m) => m.role === "admin" && m.status === "active" && m.userId !== input.actorId);
  const vars = { actor: input.actor, count: input.count, label: input.label, org: input.orgName };
  for (const admin of admins) {
    await sendEmail(
      renderEmail({
        locale: input.locale,
        to: admin.email,
        subject: t("copySubmitted.subject", vars),
        heading: t("copySubmitted.heading", vars),
        lines: [t("copySubmitted.body", vars)],
        button: { label: t("copySubmitted.button"), url },
        note: t("noticeNote", { org: input.orgName }),
      }),
    );
  }
  return admins.length;
}

/** Approval or a change request, to the person who wrote the copy (not when they reviewed it themselves). */
export async function notifyCopyReviewed(input: {
  orgId: string;
  orgName: string;
  authorId: string | null;
  actorId: string;
  actor: string;
  outcome: "approved" | "changes_requested";
  label: string;
  count: number;
  note: string | null;
  copyId: string | null;
  locale: EmailLocale;
}) {
  if (!input.authorId || input.authorId === input.actorId) return 0;
  const author = (await listMembers({ orgId: input.orgId })).find((m) => m.userId === input.authorId && m.status === "active");
  if (!author) return 0;
  const t = emailTranslator(input.locale);
  const key = input.outcome === "approved" ? "copyApproved" : "copyChanges";
  const vars = { actor: input.actor, label: input.label, count: input.count, org: input.orgName };
  const url = `${await appUrl()}/${input.locale}/copy${input.copyId ? `?copy=${encodeURIComponent(input.copyId)}` : ""}`;
  await sendEmail(
    renderEmail({
      locale: input.locale,
      to: author.email,
      subject: t(`${key}.subject`, vars),
      heading: t(`${key}.heading`, vars),
      lines: [t(`${key}.body`, vars)],
      quote: input.note ?? undefined,
      button: { label: t("copyOpen"), url },
      note: t("noticeNote", { org: input.orgName }),
    }),
  );
  return 1;
}

/**
 * Old videos about to be removed by the retention sweep: every active admin of the org. Sent from the
 * schedule, so there is no request language; English until users have a saved language.
 */
export async function notifyVideoCleanup(input: { orgId: string; orgName: string; count: number; days: number; removeOn: string; locale?: EmailLocale }) {
  const locale = input.locale ?? "en";
  const t = emailTranslator(locale);
  const admins = (await listMembers({ orgId: input.orgId })).filter((m) => m.role === "admin" && m.status === "active");
  const date = new Intl.DateTimeFormat(locale, { ...LATN, dateStyle: "long", timeZone: "UTC" }).format(new Date(input.removeOn));
  const vars = { count: input.count, days: input.days, date, org: input.orgName };
  const url = `${await appUrl()}/${locale}/history`;
  for (const admin of admins) {
    await sendEmail(
      renderEmail({
        locale,
        to: admin.email,
        subject: t("videoCleanup.subject", vars),
        heading: t("videoCleanup.heading", vars),
        lines: [t("videoCleanup.body", vars), t("videoCleanup.keep")],
        button: { label: t("videoCleanup.button"), url },
        note: t("noticeNote", { org: input.orgName }),
      }),
    );
  }
  return admins.length;
}

/** The current request's language for emails (en outside a request, where getLocale throws). */
export async function requestEmailLocale(): Promise<EmailLocale> {
  try {
    return emailLocale(await getLocale());
  } catch {
    return "en";
  }
}

/** Runs a notice without letting it fail the action that triggered it. */
export async function quietly(label: string, notice: () => Promise<unknown>) {
  try {
    await notice();
  } catch (error) {
    reportError(`${label} notice failed`, error, {});
  }
}
