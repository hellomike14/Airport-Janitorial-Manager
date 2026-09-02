import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { messageEmailOutboxTable } from "@workspace/db/schema";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  outboxTransitionForResult,
  type PublicEmailDeliveryStatus,
} from "./messageEmailDeliveryPolicy";
import { sendInspectorConversationEmail } from "./sendgridEmailBridge";

type Environment = Record<string, string | undefined>;
type ClaimedOutboxItem = typeof messageEmailOutboxTable.$inferSelect;

function integerSetting(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function workerSettings(env: Environment) {
  return {
    pollMs: integerSetting(env.MESSAGE_EMAIL_OUTBOX_POLL_MS, 1_000, 250, 60_000),
    leaseMs: integerSetting(env.MESSAGE_EMAIL_OUTBOX_LEASE_MS, 60_000, 30_000, 10 * 60_000),
    batchSize: integerSetting(env.MESSAGE_EMAIL_OUTBOX_BATCH_SIZE, 10, 1, 100),
    maxAttempts: integerSetting(env.MESSAGE_EMAIL_OUTBOX_MAX_ATTEMPTS, 8, 1, 50),
  };
}

async function claimNextOutboxItem(
  leaseMs: number,
  now = new Date(),
  messageId?: number,
): Promise<ClaimedOutboxItem | undefined> {
  const staleBefore = new Date(now.getTime() - leaseMs);
  const readyCondition = or(
    and(
      inArray(messageEmailOutboxTable.status, ["pending", "retrying"]),
      lte(messageEmailOutboxTable.nextAttemptAt, now),
    ),
    and(
      eq(messageEmailOutboxTable.status, "sending"),
      or(
        isNull(messageEmailOutboxTable.lockedAt),
        lt(messageEmailOutboxTable.lockedAt, staleBefore),
      ),
    ),
  );
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(messageEmailOutboxTable)
      .where(
        messageId === undefined
          ? readyCondition
          : and(eq(messageEmailOutboxTable.messageId, messageId), readyCondition),
      )
      .orderBy(asc(messageEmailOutboxTable.nextAttemptAt), asc(messageEmailOutboxTable.id))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) return undefined;
    const lockToken = randomUUID();
    const [claimed] = await tx
      .update(messageEmailOutboxTable)
      .set({
        status: "sending",
        attemptCount: candidate.attemptCount + 1,
        lockedAt: now,
        lockToken,
        updatedAt: now,
      })
      .where(eq(messageEmailOutboxTable.id, candidate.id))
      .returning();
    return claimed;
  });
}

async function readOutboxStatus(
  messageId: number,
): Promise<PublicEmailDeliveryStatus> {
  const [row] = await db
    .select({ status: messageEmailOutboxTable.status })
    .from(messageEmailOutboxTable)
    .where(eq(messageEmailOutboxTable.messageId, messageId));
  return row?.status ?? "not_applicable";
}

async function deliverClaimedOutboxItem(
  item: ClaimedOutboxItem,
  maxAttempts: number,
  env: Environment,
): Promise<void> {
  if (!item.lockToken) return;
  const delivery = await sendInspectorConversationEmail(
    {
      conversationId: item.conversationId,
      inspectorId: item.inspectorId,
      supervisorId: item.supervisorId,
      inspectorEmail: item.inspectorEmail,
      inspectorName: item.inspectorName,
      supervisorName: item.supervisorName,
      messageBody: item.messageBody,
    },
    env,
  );
  const now = new Date();
  const transition = outboxTransitionForResult({
    result: delivery,
    attemptCount: item.attemptCount,
    maxAttempts,
    now,
  });
  const [updated] = await db
    .update(messageEmailOutboxTable)
    .set({
      ...transition,
      lockedAt: null,
      lockToken: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(messageEmailOutboxTable.id, item.id),
        eq(messageEmailOutboxTable.status, "sending"),
        eq(messageEmailOutboxTable.lockToken, item.lockToken),
      ),
    )
    .returning({ id: messageEmailOutboxTable.id });

  // A missing update means the lease was reclaimed by another instance. That
  // instance owns the final state, so this worker must not overwrite it.
  if (!updated) return;
  const logEntry = {
    event: "inspector_message_email",
    status: transition.status,
    outboxId: item.id,
    messageId: item.messageId,
    conversationId: item.conversationId,
    attemptCount: item.attemptCount,
    ...(transition.lastError ? { error: transition.lastError } : {}),
  };
  if (transition.status === "failed") {
    console.error(JSON.stringify(logEntry));
  } else if (
    transition.status === "retrying" ||
    transition.status === "not_configured"
  ) {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.info(JSON.stringify(logEntry));
  }
}

let wakeActiveWorker: (() => void) | null = null;

/** Ask the local worker to poll now. The durable row remains the source of
 * truth, so losing this in-memory hint during autoscale shutdown is harmless. */
export function wakeMessageEmailOutboxWorker(): void {
  wakeActiveWorker?.();
}

/**
 * Make one bounded delivery attempt while the originating HTTP request is
 * still alive. If another worker already owns the lease, wait only long enough
 * to observe that attempt's persisted result. Durable polling remains the
 * fallback for retries and process termination.
 */
export async function attemptMessageEmailOutboxDelivery(
  messageId: number,
  env: Environment = process.env,
): Promise<PublicEmailDeliveryStatus> {
  const settings = workerSettings(env);
  const waitDeadline = Date.now() + 17_000;
  for (;;) {
    const claimed = await claimNextOutboxItem(settings.leaseMs, new Date(), messageId);
    if (claimed) {
      await deliverClaimedOutboxItem(claimed, settings.maxAttempts, env);
      return readOutboxStatus(messageId);
    }

    const status = await readOutboxStatus(messageId);
    if (status !== "sending") return status;
    if (Date.now() >= waitDeadline) return status;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

export function startMessageEmailOutboxWorker(
  env: Environment = process.env,
): () => void {
  const settings = workerSettings(env);
  let stopped = false;
  let running = false;
  let rerunRequested = false;

  const run = async () => {
    if (stopped) return;
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      do {
        rerunRequested = false;
        for (let index = 0; index < settings.batchSize; index += 1) {
          const item = await claimNextOutboxItem(settings.leaseMs);
          if (!item) break;
          await deliverClaimedOutboxItem(item, settings.maxAttempts, env);
        }
      } while (rerunRequested && !stopped);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "message_email_outbox_worker",
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown outbox worker error",
        }),
      );
    } finally {
      running = false;
    }
  };

  const wake = () => {
    queueMicrotask(() => void run());
  };
  wakeActiveWorker = wake;
  const timer = setInterval(wake, settings.pollMs);
  timer.unref();
  wake();

  return () => {
    stopped = true;
    clearInterval(timer);
    if (wakeActiveWorker === wake) wakeActiveWorker = null;
  };
}
