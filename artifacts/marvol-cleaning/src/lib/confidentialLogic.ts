import type { ConfidentialAccessState } from "@workspace/api-client-react";

/** Milliseconds of unlocked time left, measured on the server's clock. */
export function unlockedMsLeft(s: ConfidentialAccessState | null, receivedAt: number, now: number): number {
  if (!s || !s.unlocked || !s.expiresAt) return 0;
  const exp = Date.parse(s.expiresAt), srv = Date.parse(s.serverTime);
  if (Number.isNaN(exp) || Number.isNaN(srv)) return 0;
  return Math.max(0, exp - srv - (now - receivedAt));
}
export function cooldownMsLeft(s: ConfidentialAccessState | null, receivedAt: number, now: number): number {
  if (!s?.lockedUntil) return 0;
  const until = Date.parse(s.lockedUntil), srv = Date.parse(s.serverTime);
  if (Number.isNaN(until) || Number.isNaN(srv)) return 0;
  return Math.max(0, until - srv - (now - receivedAt));
}
export const isValidCode = (c: string) => /^\d{8,12}$/.test(c);
export function mayRenderPrivate(role: string, s: ConfidentialAccessState | null, receivedAt: number, now: number) {
  return role === "admin" && unlockedMsLeft(s, receivedAt, now) > 0;
}
export function isSensitiveKey(key: readonly unknown[]): boolean {
  const flat = key.map(k => (typeof k === "string" ? k : "")).join("|").toLowerCase();
  return /staff\/confidential|staff\/former|auth-diagnostics|quickbooks|applications|employment-form-submissions|employment-forms|identity-documents|identity-photo|hr-form|hr-photo/.test(flat);
}
