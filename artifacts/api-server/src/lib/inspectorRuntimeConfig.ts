const boundedInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
};

export function inspectorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    replyTokenTtlSeconds:
      boundedInteger(env.SENDGRID_REPLY_TOKEN_TTL_DAYS, 7, 1, 365) * 86_400,
    outboxPollMs: boundedInteger(
      env.MESSAGE_EMAIL_OUTBOX_POLL_MS,
      30_000,
      1_000,
      3_600_000,
    ),
    outboxLeaseMs: boundedInteger(
      env.MESSAGE_EMAIL_OUTBOX_LEASE_MS,
      5 * 60_000,
      10_000,
      3_600_000,
    ),
    outboxBatchSize: boundedInteger(
      env.MESSAGE_EMAIL_OUTBOX_BATCH_SIZE,
      10,
      1,
      100,
    ),
    outboxMaxAttempts: boundedInteger(
      env.MESSAGE_EMAIL_OUTBOX_MAX_ATTEMPTS,
      5,
      1,
      100,
    ),
    escalationPollMs: boundedInteger(
      env.INSPECTOR_ESCALATION_POLL_MS,
      60_000,
      5_000,
      3_600_000,
    ),
  };
}