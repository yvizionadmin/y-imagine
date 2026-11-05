// Org roles, shared by client and server (members.ts is server-only).
export const ROLES = ["admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value);
