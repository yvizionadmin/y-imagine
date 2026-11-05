// Provider failures mapped to stable codes so the UI can show a localized, actionable message
// without ever echoing raw provider responses (which may contain request details).
export type ProviderErrorCode =
  | "generation_failed"
  /** No connected provider key can serve this tool. */
  | "no_provider"
  /** The provider rejected the org's key (it was revoked or rotated outside Imagine AI). */
  | "invalid_key"
  /** The org's provider account is out of credits or over its spending limit. */
  | "no_credits"
  /** The org's monthly Imagine AI job quota is used up. */
  | "quota_exceeded"
  | "rate_limited"
  | "unsupported"
  | "feature_disabled";

export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ProviderError";
  }
}
