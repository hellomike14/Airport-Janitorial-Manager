import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateInspectorEmailStatus,
  classifyInboundInspectorEmailTarget,
  createReplyToken,
  INSPECTOR_EMAIL,
  INSPECTOR_RECIPIENT_EMAILS,
  isAuthorizedInspectorEmailSender,
  groupInspectorEmailRecipients,
  outboundEmailStatus,
  resolveInspectorRecipients,
  verifyReplyToken,
  senderMailbox,
} from "./sendgridEmailBridge";

const key = "a".repeat(32);
test("display names and forwarded SRS messages preserve the approved original sender", () => {
  const sender = "ashley.maynard@goaa.org";
  const from = '"Maynard, Ashley" <Ashley.Maynard@GOAA.org>';
  assert.equal(senderMailbox(from), sender);
  assert.equal(isAuthorizedInspectorEmailSender(from, sender, "pass"), sender);
  assert.equal(isAuthorizedInspectorEmailSender(from, "SRS0=fixture@marvolenterprises.com", "pass", "{@goaa.org : pass}"), sender);
  assert.equal(isAuthorizedInspectorEmailSender(from, "SRS0=fixture@marvolenterprises.com", "pass"), null);
  for (const dkim of ["{@notgoaa.org : pass}", "{@goaa.org.evil.test : pass}", "{@goaa.org : pass-fake}", "{@goaa.org : fail}", "{@marvolenterprises.com : pass}"]) {
    assert.equal(isAuthorizedInspectorEmailSender(from, "forwarder@marvolenterprises.com", "pass", dkim), null, dkim);
  }
  for (const value of ["Ashley <ashley.maynard@goaa.org>, Intruder <bad@example.com>", "a@example.com, ashley.maynard@goaa.org", "Ashley\r\nFrom: <ashley.maynard@goaa.org>"]) {
    assert.equal(isAuthorizedInspectorEmailSender(value, sender, "pass", "{@goaa.org : pass}"), null);
  }
  assert.equal(isAuthorizedInspectorEmailSender("Unknown <unknown@goaa.org>", "unknown@goaa.org", "pass", "{@goaa.org : pass}"), null);
});
test("reply tokens are signed, scoped, and expire", () => {
  const token = createReplyToken({ conversationId: 7, inspectorId: 8, supervisorId: 9, expiresAt: 200 }, key);
  assert.deepEqual(verifyReplyToken(token, key, 199), { conversationId: 7, inspectorId: 8, supervisorId: 9 });
  assert.equal(verifyReplyToken(`${token}x`, key, 199), null);
  assert.equal(verifyReplyToken(token, key, 201), null);
});
test("missing SendGrid configuration never claims delivery", () => {
  assert.equal(outboundEmailStatus({ SENDGRID_EMAIL_BRIDGE_ENABLED: "off" }), "disabled");
  assert.equal(outboundEmailStatus({}), "not_configured");
});

test("only the eleven configured external inspector addresses can be selected", () => {
  assert.equal(INSPECTOR_RECIPIENT_EMAILS.length, 11);
  assert.equal(resolveInspectorRecipients(undefined), null);
  assert.deepEqual(resolveInspectorRecipients([" AMBER.NORDICK@GOAA.ORG "]), ["amber.nordick@goaa.org"]);
  assert.deepEqual(resolveInspectorRecipients([...INSPECTOR_RECIPIENT_EMAILS]), [...INSPECTOR_RECIPIENT_EMAILS]);
  assert.deepEqual(resolveInspectorRecipients(["  MOUSSA.BARMAKI@GOAA.ORG  "]), ["moussa.barmaki@goaa.org"]);
  assert.ok(INSPECTOR_RECIPIENT_EMAILS.includes("moussa.barmaki@goaa.org"));
  assert.equal(resolveInspectorRecipients(["amber.nordick@goaa.org", "arcolon@goaa.org"]), null);
  assert.equal(resolveInspectorRecipients(["amber.nordick@goaa.org", "AMBER.NORDICK@GOAA.ORG"]), null);
  assert.equal(resolveInspectorRecipients(["amber.nordick@goaa.org", "amber.nordick+other@goaa.org"]), null);
  assert.equal(resolveInspectorRecipients(["attacker@example.com"]), null);
  assert.equal(resolveInspectorRecipients(["moussa.barmaki@goaa.org.evil.test"]), null);
  assert.equal(resolveInspectorRecipients(["moussa.barmaki+lookalike@goaa.org"]), null);
  assert.equal(resolveInspectorRecipients([]), null);
});

test("inbound inspector senders must be allowlisted, envelope-matched, and authenticated", () => {
  assert.equal(
    isAuthorizedInspectorEmailSender(" AMBER.NORDICK@GOAA.ORG ", "amber.nordick@goaa.org", "pass"),
    "amber.nordick@goaa.org",
  );
  assert.equal(isAuthorizedInspectorEmailSender("amber.nordick@goaa.org", "arcolon@goaa.org", "pass"), null);
  assert.equal(isAuthorizedInspectorEmailSender("unknown@goaa.org", "unknown@goaa.org", "pass"), null);
  assert.equal(isAuthorizedInspectorEmailSender("amber.nordick@goaa.org", "amber.nordick@goaa.org", "fail", "unverified"), null);
});

test("Moussa is an exact authenticated inspector sender; a spoofed From header alone is rejected", () => {
  const from = "Moussa Barmaki < MOUSSA.BARMAKI@GOAA.ORG >";
  const sender = "moussa.barmaki@goaa.org";
  assert.equal(isAuthorizedInspectorEmailSender(from, " MOUSSA.BARMAKI@GOAA.ORG ", "pass"), sender);
  assert.equal(isAuthorizedInspectorEmailSender(from, "SRS0=fixture@marvolenterprises.com", "pass", "{@goaa.org : pass}"), sender);
  assert.equal(isAuthorizedInspectorEmailSender(from, "attacker@goaa.org", "pass"), null);
  assert.equal(isAuthorizedInspectorEmailSender(from, "attacker@goaa.org", "fail", "{@goaa.org : pass-fake}"), null);
  assert.equal(
    isAuthorizedInspectorEmailSender("Moussa <moussa.barmaki@goaa.org.evil.test>", "moussa.barmaki@goaa.org.evil.test", "pass"),
    null,
  );
  assert.equal(
    isAuthorizedInspectorEmailSender("Moussa <moussa.barmaki+lookalike@goaa.org>", "moussa.barmaki+lookalike@goaa.org", "pass"),
    null,
  );
});

test("inbound target classification allows signed replies and exact direct recipients only", () => {
  const domain = "mail.marvolenterprises.com";
  const token = createReplyToken({ conversationId: 7, inspectorId: 8, supervisorId: 9, expiresAt: 200 }, key);
  const replyAddress = `reply+${token}@${domain}`;
  const replyTarget = classifyInboundInspectorEmailTarget([replyAddress], domain);
  assert.deepEqual(replyTarget, { kind: "reply", token });
  if (replyTarget.kind === "reply") {
    assert.deepEqual(verifyReplyToken(replyTarget.token, key, 199), { conversationId: 7, inspectorId: 8, supervisorId: 9 });
  }

  assert.deepEqual(classifyInboundInspectorEmailTarget([INSPECTOR_EMAIL], domain), { kind: "direct" });
  assert.deepEqual(classifyInboundInspectorEmailTarget([`INSPECTOR@${domain}`], domain), { kind: "direct" });
  assert.deepEqual(classifyInboundInspectorEmailTarget([`inspector@${domain}`], undefined), { kind: "invalid" });
  assert.deepEqual(classifyInboundInspectorEmailTarget(["unknown@example.com"], domain), { kind: "invalid" });

  const invalidReply = classifyInboundInspectorEmailTarget([`reply+unsigned@${domain}`, INSPECTOR_EMAIL], domain);
  assert.deepEqual(invalidReply, { kind: "reply", token: "unsigned" });
  if (invalidReply.kind === "reply") assert.equal(verifyReplyToken(invalidReply.token, key, 199), null);
  assert.deepEqual(classifyInboundInspectorEmailTarget([`reply+${token}@attacker.example`], domain), { kind: "invalid" });
});

test("outbound mail must be configured from the shared inspector identity", () => {
  const env = {
    SENDGRID_API_KEY: "configured-api-key",
    SENDGRID_FROM_EMAIL: INSPECTOR_EMAIL,
    SENDGRID_INBOUND_DOMAIN: "mail.marvolenterprises.com",
    SENDGRID_REPLY_TOKEN_SECRET: key,
    SENDGRID_INBOUND_WEBHOOK_SECRET: key,
  };
  assert.equal(outboundEmailStatus(env), "pending");
  assert.equal(outboundEmailStatus({ ...env, SENDGRID_FROM_EMAIL: "someone@marvolenterprises.com" }), "not_configured");
});

test("aggregated status requires every recipient accepted and surfaces any failure", () => {
  assert.equal(aggregateInspectorEmailStatus([]), null);
  assert.equal(aggregateInspectorEmailStatus(["accepted", "accepted"]), "accepted");
  assert.equal(aggregateInspectorEmailStatus(["accepted", "failed", "pending"]), "failed");
  assert.equal(aggregateInspectorEmailStatus(["accepted", "retrying"]), "retrying");
  assert.equal(aggregateInspectorEmailStatus(["not_configured", "not_configured"]), "not_configured");
});

test("per-message recipient visibility reports selected addresses and leaves other messages empty", () => {
  const recipients = groupInspectorEmailRecipients([
    { messageId: 1, inspectorEmail: "amber.nordick@goaa.org" },
    { messageId: 1, inspectorEmail: "arcolon@goaa.org" },
    { messageId: 1, inspectorEmail: "amber.nordick@goaa.org" },
    { messageId: 3, inspectorEmail: "raquel.santana@goaa.org" },
  ]);
  assert.deepEqual(recipients.get(1), ["amber.nordick@goaa.org", "arcolon@goaa.org"]);
  assert.deepEqual(recipients.get(2) ?? [], []);
  assert.deepEqual(recipients.get(3), ["raquel.santana@goaa.org"]);
});
