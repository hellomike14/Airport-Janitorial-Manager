import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { messageEmailOutboxTable } from "@workspace/db/schema";
import { createReplyToken, normalizedEmail, outboundEmailStatus } from "./sendgridEmailBridge";
import { inspectorRuntimeConfig } from "./inspectorRuntimeConfig";

export type SendGridTransport = (request: { apiKey: string; from: string; to: string; replyTo: string; subject: string; text: string; outboxId: number; providerMessageKey: string }) => Promise<void>;
export const sendGridTransport: SendGridTransport = async (request) => {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST", headers: { authorization: `Bearer ${request.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ personalizations: [{ to: [{ email: request.to }], custom_args: { outbox_id: String(request.outboxId), message_key: request.providerMessageKey } }], from: { email: request.from }, reply_to: { email: request.replyTo }, subject: request.subject, content: [{ type: "text/plain", value: request.text }] }),
  });
  if (!response.ok) throw new Error(`SendGrid rejected mail (${response.status})`);
};

const backoff = (attempt: number) => Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));

export async function deliverOneOutboxEmail(transport: SendGridTransport = sendGridTransport, now = new Date()): Promise<boolean> {
  if (outboundEmailStatus() !== "pending") return false;
  const config = inspectorRuntimeConfig();
  const token = randomUUID();
  const expiredLease = new Date(now.getTime() - config.outboxLeaseMs);
  const item = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(messageEmailOutboxTable)
      .where(or(
        and(inArray(messageEmailOutboxTable.status, ["pending", "retrying"]), lte(messageEmailOutboxTable.nextAttemptAt, now)),
        and(eq(messageEmailOutboxTable.status, "sending"), lte(messageEmailOutboxTable.lockedAt, expiredLease)),
      ))
      .orderBy(messageEmailOutboxTable.id).limit(1).for("update", { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx.update(messageEmailOutboxTable).set({ status: "sending", lockedAt: now, lockToken: token, updatedAt: now })
      .where(and(eq(messageEmailOutboxTable.id, row.id), eq(messageEmailOutboxTable.status, row.status))).returning();
    return claimed ?? null;
  });
  if (!item) return false;
  try {
    const apiKey = process.env.SENDGRID_API_KEY!;
    const from = normalizedEmail(process.env.SENDGRID_FROM_EMAIL)!;
    const domain = process.env.SENDGRID_INBOUND_DOMAIN!.trim().toLowerCase();
    const replyToken = createReplyToken({ conversationId: item.conversationId, inspectorId: item.inspectorId, supervisorId: item.supervisorId, expiresAt: Math.floor(now.getTime() / 1000) + config.replyTokenTtlSeconds }, process.env.SENDGRID_REPLY_TOKEN_SECRET!);
    await transport({ apiKey, from, to: item.inspectorEmail, replyTo: `reply+${replyToken}@${domain}`, subject: `Message from ${item.supervisorName}`, text: item.messageBody, outboxId: item.id, providerMessageKey: `outbox-${item.id}-message-${item.messageId}` });
    await db.update(messageEmailOutboxTable).set({ status: "accepted", acceptedAt: new Date(), lockToken: null, lockedAt: null, updatedAt: new Date(), lastError: null })
      .where(and(eq(messageEmailOutboxTable.id, item.id), eq(messageEmailOutboxTable.lockToken, token)));
  } catch (error) {
    const attempt = item.attemptCount + 1;
    await db.update(messageEmailOutboxTable).set({
      attemptCount: attempt, status: attempt >= config.outboxMaxAttempts ? "failed" : "retrying",
      nextAttemptAt: new Date(now.getTime() + backoff(attempt)), lockToken: null, lockedAt: null,
      lastError: error instanceof Error ? error.message.slice(0, 500) : "delivery failed", updatedAt: new Date(),
    }).where(and(eq(messageEmailOutboxTable.id, item.id), eq(messageEmailOutboxTable.lockToken, token)));
  }
  return true;
}
export async function drainOutbox(transport: SendGridTransport = sendGridTransport): Promise<number> {
  const { outboxBatchSize } = inspectorRuntimeConfig();
  let sent = 0;
  while (sent < outboxBatchSize && await deliverOneOutboxEmail(transport)) sent++;
  return sent;
}