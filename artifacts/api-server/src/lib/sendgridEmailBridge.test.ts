import assert from "node:assert/strict";
import test from "node:test";
import { createReplyToken, outboundEmailStatus, verifyReplyToken } from "./sendgridEmailBridge";

const key = "a".repeat(32);
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