export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_LEASE_MS = 5 * 60_000;
export type OutboxState = { status: string; lockedAt: Date | null; nextAttemptAt: Date; attemptCount: number; lockToken: string | null };

export function outboxClaimEligible(item: OutboxState, now: Date): boolean {
  if ((item.status === "pending" || item.status === "retrying") && item.nextAttemptAt <= now) return true;
  return item.status === "sending" && !!item.lockedAt && item.lockedAt.getTime() <= now.getTime() - OUTBOX_LEASE_MS;
}
export function outboxFailureTransition(attemptCount: number) {
  const nextAttemptCount = attemptCount + 1;
  return { attemptCount: nextAttemptCount, status: nextAttemptCount >= OUTBOX_MAX_ATTEMPTS ? "failed" as const : "retrying" as const };
}
export const leaseTokenMayFinalize = (persisted: string | null, claimant: string) => persisted === claimant;