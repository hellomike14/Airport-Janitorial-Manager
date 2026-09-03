import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplyAddress,
  createReplyToken,
  extractInboundReplyToken,
  inboundSenderAuthenticationPasses,
  inboundProviderMessageId,
  outboundBridgeConfiguration,
  sanitizeInboundPlainText,
  sendInspectorConversationEmail,
  verifyInboundWebhookSecret,
  verifyReplyToken,
} from "./sendgridEmailBridge";

const TOKEN_SECRET = "test-reply-token-secret-that-is-long-enough";
const WEBHOOK_SECRET = "test-webhook-secret-that-is-long-enough";

test("outbound configuration reports disabled and missing settings precisely", () => {
  assert.deepEqual(
    outboundBridgeConfiguration({ SENDGRID_EMAIL_BRIDGE_ENABLED: "false" }),
    { status: "disabled" },
  );
  const missing = outboundBridgeConfiguration({});
  assert.equal(missing.status, "not_configured");
  if (missing.status === "not_configured") {
    assert.ok(missing.missing?.includes("SENDGRID_API_KEY"));
    assert.ok(missing.missing?.includes("SENDGRID_FROM_EMAIL"));
  }
});

test("reply tokens round-trip and reject tampering and expiry", () => {
  const token = createReplyToken(
    { conversationId: 123, inspectorId: 9, supervisorId: 4, expiresAt: 2_000 },
    TOKEN_SECRET,
    1_000,
  );
  assert.deepEqual(verifyReplyToken(token, TOKEN_SECRET, 1_500), {
    status: "ok",
    claims: { conversationId: 123, inspectorId: 9, supervisorId: 4, expiresAt: 2_000 },
  });
  const tampered = token.replace("v1.3f", "v1.3g");
  assert.equal(verifyReplyToken(tampered, TOKEN_SECRET, 1_500).status, "invalid");
  assert.equal(verifyReplyToken(token, TOKEN_SECRET, 2_001).status, "expired");
  assert.equal(verifyReplyToken(token, "short", 1_500).status, "not_configured");
});

test("reply address stays RFC local-part safe and can be recovered", () => {
  const token = createReplyToken(
    {
      conversationId: 2_147_483_647,
      inspectorId: 2_147_483_646,
      supervisorId: 2_147_483_645,
      expiresAt: 2_147_483_644,
    },
    TOKEN_SECRET,
  );
  const address = buildReplyAddress(token, "Replies.Example.com.");
  assert.ok(address.split("@")[0]!.length <= 64);
  assert.equal(
    extractInboundReplyToken([`Airport Manager <${address}>`], "replies.example.com"),
    token,
  );
  assert.equal(extractInboundReplyToken([address], "other.example.com"), null);
});

test("plain-text sanitizer removes controls, quoted replies, and overlong content", () => {
  const sanitized = sanitizeInboundPlainText(
    `  Done\u0000 and verified.\r\n\r\n\r\nOn Tue, Manager wrote:\r\n> old content`,
  );
  assert.equal(sanitized, "Done and verified.");
  assert.equal(sanitizeInboundPlainText("x".repeat(2_100)).length, 2_000);
});

test("provider id uses Message-ID and has a stable content fallback", () => {
  const withId = inboundProviderMessageId({
    headers: "From: inspector@example.com\r\nMessage-ID: <ABC123@example.com>\r\n",
  });
  assert.match(withId, /^message-id:[a-f0-9]{64}$/);
  assert.equal(
    withId,
    inboundProviderMessageId({ headers: "message-id: <abc123@example.com>" }),
  );
  const fallback = { from: "a@example.com", text: "Done", envelope: "{}" };
  assert.equal(inboundProviderMessageId(fallback), inboundProviderMessageId(fallback));
  assert.match(inboundProviderMessageId(fallback), /^content:[a-f0-9]{64}$/);
});

test("webhook secret comparison fails closed", () => {
  assert.equal(verifyInboundWebhookSecret(WEBHOOK_SECRET, WEBHOOK_SECRET), "ok");
  assert.equal(verifyInboundWebhookSecret("wrong", WEBHOOK_SECRET), "invalid");
  assert.equal(verifyInboundWebhookSecret(WEBHOOK_SECRET, "short"), "not_configured");
});

test("inbound sender requires a passing SPF or DKIM result", () => {
  assert.equal(inboundSenderAuthenticationPasses("pass", undefined), true);
  assert.equal(
    inboundSenderAuthenticationPasses(
      "fail",
      '{"marvolenterprises.com":"pass"}',
      "inspector@marvolenterprises.com",
    ),
    true,
  );
  assert.equal(
    inboundSenderAuthenticationPasses(
      "fail",
      "{@marvolenterprises.com : pass}",
      "inspector@marvolenterprises.com",
    ),
    true,
  );
  assert.equal(
    inboundSenderAuthenticationPasses(
      "fail",
      "{@attacker.example : pass, @marvolenterprises.com : fail}",
      "inspector@marvolenterprises.com",
    ),
    false,
  );
  assert.equal(inboundSenderAuthenticationPasses("softfail", "none"), false);
  assert.equal(inboundSenderAuthenticationPasses(undefined, undefined), false);
});

test("outbound delivery reports configuration failure without fetching", async () => {
  let fetched = false;
  const result = await sendInspectorConversationEmail(
    {
      conversationId: 1,
      inspectorId: 2,
      supervisorId: 3,
      inspectorEmail: "inspector@example.com",
      inspectorName: "Inspector",
      supervisorName: "Supervisor",
      messageBody: "Please check Terminal C.",
    },
    {},
    (async () => {
      fetched = true;
      throw new Error("unexpected");
    }) as typeof fetch,
  );
  assert.equal(fetched, false);
  assert.equal(result.status, "not_configured");
});

test("outbound delivery uses plain text and a conversation-specific Reply-To", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const result = await sendInspectorConversationEmail(
    {
      conversationId: 10,
      inspectorId: 20,
      supervisorId: 30,
      inspectorEmail: "Inspector@Example.com",
      inspectorName: "Pat Inspector",
      supervisorName: "Sam Supervisor",
      messageBody: "Please check Terminal C.",
    },
    {
      SENDGRID_API_KEY: "SG.test",
      SENDGRID_FROM_EMAIL: "messages@example.com",
      SENDGRID_INBOUND_DOMAIN: "replies.example.com",
      SENDGRID_REPLY_TOKEN_SECRET: TOKEN_SECRET,
      SENDGRID_INBOUND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
    (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 202 });
    }) as typeof fetch,
  );
  assert.equal(result.status, "accepted");
  assert.equal(
    (requestBody?.["personalizations"] as Array<{ to: Array<{ email: string }> }>)[0]?.to[0]?.email,
    "inspector@example.com",
  );
  assert.match(
    (requestBody?.["reply_to"] as { email: string }).email,
    /^reply\+v1\..+@replies\.example\.com$/,
  );
  assert.equal(
    (requestBody?.["content"] as Array<{ type: string }>)[0]?.type,
    "text/plain",
  );
});
