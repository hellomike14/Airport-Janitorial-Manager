import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const INSPECTOR_EMAIL = "inspector@marvolenterprises.com";
export const INSPECTOR_RECIPIENT_EMAILS = [
  "amber.nordick@goaa.org",
  "arcolon@goaa.org",
  "ashley.maynard@goaa.org",
  "ajani.smith@goaa.org",
  "clarence.randle@goaa.org",
  "jcampbell@goaa.org",
  "madaline.miralles@goaa.org",
  "raquel.santana@goaa.org",
  "wendy.garrastegui@goaa.org",
  "yrene.ruizsanchez@goaa.org",
] as const;
const INSPECTOR_RECIPIENT_SET = new Set<string>(INSPECTOR_RECIPIENT_EMAILS);

export function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** A missing recipient choice preserves legacy broadcast behavior. */
export function resolveInspectorRecipients(recipients: readonly string[] | undefined): string[] | null {
  if (recipients === undefined) return [...INSPECTOR_RECIPIENT_EMAILS];
  if (recipients.length !== 1 && recipients.length !== INSPECTOR_RECIPIENT_EMAILS.length) return null;
  const normalized = recipients.map(normalizedEmail);
  if (normalized.some((email) => !email || !INSPECTOR_RECIPIENT_SET.has(email))) return null;
  const distinct = [...new Set(normalized as string[])];
  return distinct.length === normalized.length ? distinct : null;
}

export function isAuthorizedInspectorEmailSender(from: string, envelopeFrom: string, spf?: string, dkim?: string): string | null {
  const sender = normalizedEmail(from);
  if (
    !sender ||
    !INSPECTOR_RECIPIENT_SET.has(sender) ||
    normalizedEmail(envelopeFrom) !== sender ||
    !inboundAuthenticationPasses(spf, dkim, sender)
  ) return null;
  return sender;
}

export type InboundInspectorEmailTarget =
  | { kind: "reply"; token: string }
  | { kind: "direct" }
  | { kind: "invalid" };

export function classifyInboundInspectorEmailTarget(recipients: readonly string[], inboundDomain: string | undefined): InboundInspectorEmailTarget {
  const normalizedRecipients = recipients.map(normalizedEmail).filter((email): email is string => email !== null);
  const replyRecipients = normalizedRecipients.filter((address) => address.startsWith("reply+"));
  if (replyRecipients.length > 0) {
    const domain = inboundDomain?.trim().toLowerCase() ?? "";
    const validDomain = normalizedEmail(`webhook@${domain}`)?.split("@")[1];
    if (replyRecipients.length !== 1 || !validDomain) return { kind: "invalid" };
    const suffix = `@${validDomain}`;
    const recipient = replyRecipients[0]!;
    if (!recipient.endsWith(suffix)) return { kind: "invalid" };
    const token = recipient.slice("reply+".length, -suffix.length);
    return token ? { kind: "reply", token } : { kind: "invalid" };
  }

  if (normalizedRecipients.includes(INSPECTOR_EMAIL)) return { kind: "direct" };
  const domain = inboundDomain?.trim().toLowerCase() ?? "";
  const forwardingAddress = normalizedEmail(`inspector@${domain}`);
  if (forwardingAddress && normalizedRecipients.includes(forwardingAddress)) return { kind: "direct" };
  return { kind: "invalid" };
}

export type AggregateEmailStatus = "pending" | "sending" | "retrying" | "accepted" | "disabled" | "not_configured" | "failed";

/** Collapse the per-recipient durable deliveries into the message-level status. */
export function aggregateInspectorEmailStatus(statuses: readonly string[]): AggregateEmailStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((status) => status === "accepted")) return "accepted";
  if (statuses.includes("sending")) return "sending";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("retrying")) return "retrying";
  if (statuses.includes("not_configured")) return "not_configured";
  if (statuses.includes("disabled")) return "disabled";
  return "pending";
}

export function groupInspectorEmailRecipients(rows: readonly { messageId: number; inspectorEmail: string }[]): Map<number, string[]> {
  const recipientsByMessageId = new Map<number, string[]>();
  for (const row of rows) {
    const recipients = recipientsByMessageId.get(row.messageId) ?? [];
    if (!recipients.includes(row.inspectorEmail)) recipients.push(row.inspectorEmail);
    recipientsByMessageId.set(row.messageId, recipients);
  }
  return recipientsByMessageId;
}

function secret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length >= MIN_SECRET_LENGTH ? normalized : null;
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function outboundEmailStatus(env: Record<string, string | undefined> = process.env): "pending" | "disabled" | "not_configured" {
  if (["false", "0", "off"].includes(env.SENDGRID_EMAIL_BRIDGE_ENABLED?.trim().toLowerCase() ?? "")) return "disabled";
  return env.SENDGRID_API_KEY?.trim() && normalizedEmail(env.SENDGRID_FROM_EMAIL) === INSPECTOR_EMAIL &&
    env.SENDGRID_INBOUND_DOMAIN?.trim() && secret(env.SENDGRID_REPLY_TOKEN_SECRET) &&
    secret(env.SENDGRID_INBOUND_WEBHOOK_SECRET) ? "pending" : "not_configured";
}

/** Verifies the separately provisioned inbound credential in constant time. */
export function verifyInboundWebhookSecret(provided: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const expected = secret(env.SENDGRID_INBOUND_WEBHOOK_SECRET);
  return !!expected && !!provided && equal(provided.trim(), expected);
}
export function verifyInternalCronSecret(provided: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const expected = secret(env.INTERNAL_CRON_SECRET);
  return !!expected && !!provided && equal(provided.trim(), expected);
}

export function createReplyToken(claims: { conversationId: number; inspectorId: number; supervisorId: number; expiresAt: number }, tokenSecret: string): string {
  const key = secret(tokenSecret);
  if (!key) throw new Error("reply-token secret is not configured");
  const payload = `v1.${claims.conversationId.toString(36)}.${claims.inspectorId.toString(36)}.${claims.supervisorId.toString(36)}.${claims.expiresAt.toString(36)}`;
  return `${payload}.${createHmac("sha256", key).update(payload).digest("hex").slice(0, 24)}`;
}

export function verifyReplyToken(token: string, tokenSecret: string | undefined, now = Math.floor(Date.now() / 1000)): { conversationId: number; inspectorId: number; supervisorId: number } | null {
  const key = secret(tokenSecret);
  const parts = token.split(".");
  if (!key || parts.length !== 6 || parts[0] !== "v1" || !/^[a-z0-9.]+$/.test(token)) return null;
  const payload = parts.slice(0, 5).join(".");
  const tag = createHmac("sha256", key).update(payload).digest("hex").slice(0, 24);
  if (!equal(parts[5]!, tag)) return null;
  const values = parts.slice(1, 5).map((part) => Number.parseInt(part, 36));
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0) || values[3]! < now) return null;
  return { conversationId: values[0]!, inspectorId: values[1]!, supervisorId: values[2]! };
}

export function inboundProviderMessageId(headers: string | undefined, fallback: unknown): string {
  const match = headers?.match(/^message-id\s*:\s*<?([^>\r\n]+)>?\s*$/im)?.[1]?.trim().toLowerCase();
  return createHash("sha256").update(match ?? JSON.stringify(fallback)).digest("hex");
}

export function inboundAuthenticationPasses(spf: string | undefined, dkim: string | undefined, sender: string): boolean {
  if (/^pass(?:\s|$)/i.test(spf?.trim() ?? "")) return true;
  const domain = normalizedEmail(sender)?.split("@")[1]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !!domain && new RegExp(`@?${domain}\\s*:\\s*pass`, "i").test(dkim ?? "");
}

export { INSPECTOR_EMAIL };