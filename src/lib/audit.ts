import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Append-only org audit trail (the audit_log table). Never put secrets in `meta`.

export type AuditAction =
  | "provider_key.added"
  | "provider_key.rotated"
  | "provider_key.validated"
  | "provider_key.removed"
  | "provider_model.changed"
  | "brand_kit.updated"
  | "brand_kit.removed"
  | "copy.submitted"
  | "copy.approved"
  | "copy.changes_requested"
  | "member.invited"
  | "member.invite_resent"
  | "member.role_changed"
  | "member.removed"
  | "member.added"
  | "member.profile_updated"
  | "auth.signed_up"
  | "auth.password_reset"
  | "org.created"
  | "org.updated"
  | "org.suspended"
  | "org.reactivated"
  | "org.credits_adjusted"
  | "user.created"
  | "user.disabled"
  | "user.enabled"
  | "user.password_reset"
  | "user.sessions_revoked"
  | "user.super_admin_granted"
  | "user.super_admin_revoked"
  | "platform.settings_updated"
  | "platform.credits_updated"
  | "billing.checkout_started"
  | "billing.plan_changed"
  | "billing.cancel_requested"
  | "billing.resumed"
  | "bitly.connected"
  | "bitly.removed"
  | "image.submitted"
  | "image.approved"
  | "image.changes_requested"
  | "org.image_approval_changed"
  | "video.consent_given"
  | "video.cleaned_up";

/** orgId for entries that belong to no single org (platform settings, users). */
export const PLATFORM_ORG = "platform";

export type AuditEntry = {
  id: string;
  orgId: string;
  action: AuditAction;
  actor: string;
  /** What was acted on: a provider id, a member or user email, or an org name. */
  target: string;
  meta?: Record<string, string>;
  at: string;
};

const { auditLog } = schema;

type Row = typeof auditLog.$inferSelect;
const toEntry = ({ meta, ...row }: Row): AuditEntry => ({ ...row, action: row.action as AuditAction, ...(meta ? { meta } : {}) });
const byPrefix = (prefix?: string): SQL | undefined => (prefix ? like(auditLog.action, `${prefix.replace(/[\\%_]/g, "\\$&")}%`) : undefined);

export async function recordAudit(entry: Omit<AuditEntry, "id" | "at">) {
  await db.insert(auditLog).values({ ...entry, id: randomUUID(), meta: entry.meta ?? null });
}

/** Newest first. */
export async function listAudit(orgId: string, { prefix, limit = 20 }: { prefix?: string; limit?: number } = {}) {
  const rows = await db.forOrg(orgId).select(auditLog, byPrefix(prefix), { orderBy: [desc(auditLog.at)], limit });
  return rows.map(toEntry);
}

/** Every org's entries plus platform entries, newest first (super-admin console only). */
export async function listAllAudit({ prefix, orgId, limit = 100 }: { prefix?: string; orgId?: string; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(byPrefix(prefix), orgId ? eq(auditLog.orgId, orgId) : undefined))
    .orderBy(desc(auditLog.at))
    .limit(limit);
  return rows.map(toEntry);
}
