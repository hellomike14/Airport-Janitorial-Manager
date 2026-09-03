import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

type Environment = Record<string, string | undefined>;

const TOKEN_VERSION = "v1";
const TOKEN_TAG_HEX_LENGTH = 24;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TOKEN_TTL_DAYS = 30;
export const MAX_INBOUND_MESSAGE_LENGTH = 2000;

export interface ReplyTokenClaims {
  conversationId: number;
  inspectorId: number;
  supervisorId: number;
  expiresAt: number;
}

export type ReplyTokenVerification =
  | { status: "ok"; claims: ReplyTokenClaims }
  | { status: "expired" | "invalid" | "not_configured" };

export interface InspectorConversationEmailInput {
  conversationId: number;
  inspectorId: number;
  supervisorId: number;
  inspectorEmail: string;
  inspectorName: string;
  supervisorName: string;
  messageBody: string;
  appUrl?: string;
}

export type InspectorConversationEmailResult =
  | { status: "accepted"; replyAddress: string }
  | { status: "disabled" | "not_configured" | "failed"; error?: string };

export type OutboundBridgeConfiguration =
  | {
      status: "configured";
      apiKey: string;
      fromEmail: string;
      inboundDomain: string;
      tokenSecret: string;
      webhookSecret: string;
    }
  | { status: "disabled" | "not_configured"; missing?: string[] };

export type InboundBridgeConfiguration =
  | {
      status: "configured";
      inboundDomain: string;
      tokenSecret: string;
      webhookSecret: string;
    }
  | { status: "disabled" | "not_configured"; missing?: string[] };

function enabled(env: Environment): boolean {
  const value = env.SENDGRID_EMAIL_BRIDGE_ENABLED?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

function configuredSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function normalizeEmailAddress(value: string): string | null {
  const angleAddress = value.match(/<([^<>]+)>/);
  const candidate = (angleAddress?.[1] ?? value)
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  if (
    candidate.length === 0 ||
    candidate.length > 254 ||
    /[\s,;<>\r\n]/.test(candidate) ||
    !/^[^@]+@[^@]+$/.test(candidate)
  ) {
    return null;
  }
  const [local, domain] = candidate.split("@");
  if (!local || !domain || local.length > 64 || !normalizeInboundDomain(domain)) {
    return null;
  }
  return `${local}@${domain}`;
}

export function normalizeInboundDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length === 0 ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^[a-z0-9.-]+$/.test(domain)
  ) {
    return null;
  }
  const labels = domain.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    return null;
  }
  return domain;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function encodeInteger(value: number, label: string): string {
  return positiveInteger(value, label).toString(36);
}

function decodeInteger(value: string): number | null {
  if (!/^[1-9a-z][0-9a-z]*$/.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString(36) !== value) {
    return null;
  }
  return parsed;
}

function tokenTag(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, TOKEN_TAG_HEX_LENGTH);
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function createReplyToken(
  claims: Omit<ReplyTokenClaims, "expiresAt"> & { expiresAt?: number },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const normalizedSecret = configuredSecret(secret);
  if (!normalizedSecret) {
    throw new Error(`Reply-token secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const expiresAt = positiveInteger(
    claims.expiresAt ?? nowSeconds + DEFAULT_TOKEN_TTL_DAYS * 86_400,
    "expiresAt",
  );
  const payload = [
    TOKEN_VERSION,
    encodeInteger(claims.conversationId, "conversationId"),
    encodeInteger(claims.inspectorId, "inspectorId"),
    encodeInteger(claims.supervisorId, "supervisorId"),
    encodeInteger(expiresAt, "expiresAt"),
  ].join(".");
  return `${payload}.${tokenTag(payload, normalizedSecret)}`;
}

export function verifyReplyToken(
  token: string,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): ReplyTokenVerification {
  const normalizedSecret = configuredSecret(secret);
  if (!normalizedSecret) return { status: "not_configured" };
  if (token.length > 128 || !/^[a-z0-9.]+$/.test(token)) return { status: "invalid" };

  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== TOKEN_VERSION) {
    return { status: "invalid" };
  }
  const [version, conversationPart, inspectorPart, supervisorPart, expiresPart, tag] = parts;
  if (!version || !conversationPart || !inspectorPart || !supervisorPart || !expiresPart || !tag) {
    return { status: "invalid" };
  }
  const payload = parts.slice(0, 5).join(".");
  if (tag.length !== TOKEN_TAG_HEX_LENGTH || !safeEqual(tag, tokenTag(payload, normalizedSecret))) {
    return { status: "invalid" };
  }

  const conversationId = decodeInteger(conversationPart);
  const inspectorId = decodeInteger(inspectorPart);
  const supervisorId = decodeInteger(supervisorPart);
  const expiresAt = decodeInteger(expiresPart);
  if (!conversationId || !inspectorId || !supervisorId || !expiresAt) {
    return { status: "invalid" };
  }
  if (nowSeconds > expiresAt) return { status: "expired" };
  return {
    status: "ok",
    claims: { conversationId, inspectorId, supervisorId, expiresAt },
  };
}

export function buildReplyAddress(token: string, inboundDomain: string): string {
  const domain = normalizeInboundDomain(inboundDomain);
  if (!domain || !/^[a-z0-9.]+$/.test(token)) {
    throw new Error("Invalid reply token or inbound domain");
  }
  const localPart = `reply+${token}`;
  if (localPart.length > 64) {
    throw new Error("Reply token is too long for an email local-part");
  }
  return `${localPart}@${domain}`;
}

export function extractInboundReplyToken(
  recipients: readonly string[],
  inboundDomain: string,
): string | null {
  const domain = normalizeInboundDomain(inboundDomain);
  if (!domain) return null;
  for (const raw of recipients) {
    const address = normalizeEmailAddress(raw);
    if (!address) continue;
    const separator = address.lastIndexOf("@");
    const local = address.slice(0, separator);
    const addressDomain = address.slice(separator + 1);
    if (addressDomain === domain && local.startsWith("reply+")) {
      const token = local.slice("reply+".length);
      if (/^[a-z0-9.]+$/.test(token)) return token;
    }
  }
  return null;
}

function truncateUnicode(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

export function sanitizeInboundPlainText(
  value: string,
  maxLength = MAX_INBOUND_MESSAGE_LENGTH,
): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const kept: string[] = [];
  for (const line of normalized.split("\n")) {
    if (
      /^\s*>/.test(line) ||
      /^\s*On .+ wrote:\s*$/i.test(line) ||
      /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line) ||
      /^\s*_{5,}\s*$/.test(line)
    ) {
      break;
    }
    kept.push(line.trimEnd());
  }
  const compact = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return truncateUnicode(compact, maxLength).trimEnd();
}

export function inboundProviderMessageId(input: {
  headers?: string;
  envelope?: string;
  from?: string;
  subject?: string;
  text?: string;
}): string {
  const headers = input.headers?.replace(/\r\n[ \t]+/g, " ") ?? "";
  const messageIdMatch = headers.match(/^message-id\s*:\s*<?([^>\r\n]+)>?\s*$/im);
  const rawId = messageIdMatch?.[1]?.trim().toLowerCase();
  if (rawId) {
    return `message-id:${createHash("sha256").update(rawId).digest("hex")}`;
  }
  const stablePayload = JSON.stringify([
    input.envelope ?? "",
    input.from ?? "",
    input.subject ?? "",
    input.text ?? "",
    headers,
  ]);
  return `content:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

export function inboundBridgeConfiguration(
  env: Environment = process.env,
): InboundBridgeConfiguration {
  if (!enabled(env)) return { status: "disabled" };
  const inboundDomain = normalizeInboundDomain(env.SENDGRID_INBOUND_DOMAIN ?? "");
  const tokenSecret = configuredSecret(env.SENDGRID_REPLY_TOKEN_SECRET);
  const webhookSecret = configuredSecret(env.SENDGRID_INBOUND_WEBHOOK_SECRET);
  const missing: string[] = [];
  if (!inboundDomain) missing.push("SENDGRID_INBOUND_DOMAIN");
  if (!tokenSecret) missing.push("SENDGRID_REPLY_TOKEN_SECRET (32+ characters)");
  if (!webhookSecret) missing.push("SENDGRID_INBOUND_WEBHOOK_SECRET (32+ characters)");
  if (!inboundDomain || !tokenSecret || !webhookSecret) {
    return { status: "not_configured", missing };
  }
  return { status: "configured", inboundDomain, tokenSecret, webhookSecret };
}

/**
 * Performs the same fail-closed configuration check used by Mail Send without
 * making a network request. Message creation uses this to persist an honest
 * initial outbox state instead of claiming that every email was queued.
 */
export function outboundBridgeConfiguration(
  env: Environment = process.env,
): OutboundBridgeConfiguration {
  if (!enabled(env)) return { status: "disabled" };
  const apiKey = env.SENDGRID_API_KEY?.trim();
  const fromEmail = normalizeEmailAddress(env.SENDGRID_FROM_EMAIL ?? "");
  const inboundDomain = normalizeInboundDomain(env.SENDGRID_INBOUND_DOMAIN ?? "");
  const tokenSecret = configuredSecret(env.SENDGRID_REPLY_TOKEN_SECRET);
  const webhookSecret = configuredSecret(env.SENDGRID_INBOUND_WEBHOOK_SECRET);
  const missing: string[] = [];
  if (!apiKey) missing.push("SENDGRID_API_KEY");
  if (!fromEmail) missing.push("SENDGRID_FROM_EMAIL");
  if (!inboundDomain) missing.push("SENDGRID_INBOUND_DOMAIN");
  if (!tokenSecret) missing.push("SENDGRID_REPLY_TOKEN_SECRET (32+ characters)");
  if (!webhookSecret) missing.push("SENDGRID_INBOUND_WEBHOOK_SECRET (32+ characters)");
  if (!apiKey || !fromEmail || !inboundDomain || !tokenSecret || !webhookSecret) {
    return { status: "not_configured", missing };
  }
  return {
    status: "configured",
    apiKey,
    fromEmail,
    inboundDomain,
    tokenSecret,
    webhookSecret,
  };
}

export function verifyInboundWebhookSecret(
  provided: string | undefined,
  expected: string | undefined,
): "ok" | "invalid" | "not_configured" {
  const normalizedExpected = configuredSecret(expected);
  if (!normalizedExpected) return "not_configured";
  if (!provided || !safeEqual(provided.trim(), normalizedExpected)) return "invalid";
  return "ok";
}

/** Require SendGrid's inbound SPF or DKIM result to authenticate the sender. */
export function inboundSenderAuthenticationPasses(
  spf: string | undefined,
  dkim: string | undefined,
  expectedSenderEmail?: string,
): boolean {
  const spfPass = /^pass(?:\s|$)/i.test(spf?.trim() ?? "");
  if (spfPass) return true;
  const expectedAddress = expectedSenderEmail
    ? normalizeEmailAddress(expectedSenderEmail)
    : null;
  const expectedDomain = expectedAddress?.split("@")[1];
  if (!expectedDomain) return false;

  const dkimResult = dkim?.trim() ?? "";
  let jsonDkimPass = false;
  if (dkimResult.startsWith("{")) {
    try {
      const decoded = JSON.parse(dkimResult) as unknown;
      jsonDkimPass =
        typeof decoded === "object" &&
        decoded !== null &&
        !Array.isArray(decoded) &&
        Object.entries(decoded).some(
          ([domain, result]) =>
            domain.trim().toLowerCase().replace(/^@/, "") === expectedDomain &&
            typeof result === "string" &&
            /^pass$/i.test(result.trim()),
        );
    } catch {
      // SendGrid's legacy representation is object-like but not valid JSON;
      // the constrained status-value pattern below handles that form.
    }
  }
  const escapedDomain = expectedDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const legacyDkimPass = new RegExp(
    `(?:^|[{,]\\s*)@?${escapedDomain}\\s*:\\s*pass\\s*(?:[,}]|$)`,
    "i",
  ).test(dkimResult);
  return jsonDkimPass || legacyDkimPass;
}

function tokenTtlDays(env: Environment): number {
  const parsed = Number(env.SENDGRID_REPLY_TOKEN_TTL_DAYS);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365
    ? parsed
    : DEFAULT_TOKEN_TTL_DAYS;
}

function singleLine(value: string, maxLength: number): string {
  return truncateUnicode(value.replace(/[\r\n]+/g, " ").trim(), maxLength);
}

export function buildInspectorConversationEmail(
  input: InspectorConversationEmailInput,
): { subject: string; body: string } {
  const supervisorName = singleLine(input.supervisorName, 100) || "Your supervisor";
  const inspectorName = singleLine(input.inspectorName, 100) || "Inspector";
  const messageBody = truncateUnicode(
    input.messageBody
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim(),
    MAX_INBOUND_MESSAGE_LENGTH,
  );
  const appUrl = input.appUrl?.trim().replace(/\/$/, "");
  return {
    subject: `[Airport Manager] Message from ${supervisorName}`,
    body: [
      `Hello ${inspectorName},`,
      "",
      `${supervisorName} sent you a message in Airport Janitorial Manager:`,
      "",
      messageBody,
      "",
      "Reply directly to this email to send your response back into this conversation.",
      "For an urgent cleaning assignment, include the exact configured area on its own line, for example:",
      "Location: Terminal B - East / Level 4 - Row C-G",
      "Optional: add `Coordinates: latitude, longitude` so the app can select the geographically nearest on-area employee.",
      ...(appUrl ? ["", `Open messages: ${appUrl}/messages`] : []),
    ].join("\n"),
  };
}

export async function sendInspectorConversationEmail(
  input: InspectorConversationEmailInput,
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<InspectorConversationEmailResult> {
  const configuration = outboundBridgeConfiguration(env);
  if (configuration.status !== "configured") {
    return { status: configuration.status };
  }
  const inspectorEmail = normalizeEmailAddress(input.inspectorEmail);
  if (!inspectorEmail) {
    return { status: "not_configured" };
  }

  const { apiKey, fromEmail, inboundDomain, tokenSecret } = configuration;

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createReplyToken(
      {
        conversationId: input.conversationId,
        inspectorId: input.inspectorId,
        supervisorId: input.supervisorId,
        expiresAt: nowSeconds + tokenTtlDays(env) * 86_400,
      },
      tokenSecret,
      nowSeconds,
    );
    const replyAddress = buildReplyAddress(token, inboundDomain);
    const email = buildInspectorConversationEmail({
      ...input,
      appUrl: input.appUrl ?? env.PUBLIC_APP_URL,
    });
    const response = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: inspectorEmail }] }],
        from: { email: fromEmail, name: "Airport Janitorial Manager" },
        reply_to: { email: replyAddress, name: "Airport Manager conversation" },
        subject: email.subject,
        content: [{ type: "text/plain", value: email.body }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { status: "failed", error: `SendGrid Mail Send returned HTTP ${response.status}` };
    }
    return { status: "accepted", replyAddress };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown SendGrid delivery error",
    };
  }
}
