// Jobs that can't succeed until someone changes a setting: the platform refused them before they
// reached the provider (quota, kill switch), or the org's AI setup can't serve them (no key, key
// rejected, provider account out of credits, model can't do this). Shared by every tool's failed
// state; retrying won't help, so the UI hides "Try again" and says who can fix it.
export const BLOCKED_REASONS = ["quota", "plan", "disabled", "no_provider", "invalid_key", "no_credits", "unsupported"] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

const BY_CODE: Record<string, BlockedReason> = {
  quota_exceeded: "quota",
  not_in_plan: "plan",
  feature_disabled: "disabled",
  no_provider: "no_provider",
  invalid_key: "invalid_key",
  no_credits: "no_credits",
  unsupported: "unsupported",
};

export function blockedReason(code: string): BlockedReason | null {
  return BY_CODE[code] ?? null;
}

export const isBlocked = (reason: string): reason is BlockedReason => (BLOCKED_REASONS as readonly string[]).includes(reason);
