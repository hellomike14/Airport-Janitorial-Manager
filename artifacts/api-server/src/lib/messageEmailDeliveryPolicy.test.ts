import assert from "node:assert/strict";
import test from "node:test";
import {
  initialEmailDeliveryStatus,
  isExactMessageReplay,
  outboxTransitionForResult,
  retryDelayMs,
} from "./messageEmailDeliveryPolicy";

const configured = {
  status: "configured" as const,
  apiKey: "test-key",
  fromEmail: "messages@example.com",
  inboundDomain: "replies.example.com",
  tokenSecret: "t".repeat(32),
  webhookSecret: "w".repeat(32),
};

test("initial status distinguishes persisted, disabled, unconfigured, and irrelevant email", () => {
  assert.equal(initialEmailDeliveryStatus(false, configured), "not_applicable");
  assert.equal(initialEmailDeliveryStatus(true, configured), "pending");
  assert.equal(
    initialEmailDeliveryStatus(true, { status: "disabled" }),
    "disabled",
  );
  assert.equal(
    initialEmailDeliveryStatus(true, {
      status: "not_configured",
      missing: ["SENDGRID_API_KEY"],
    }),
    "not_configured",
  );
});

test("idempotency replay must match the same sender, conversation, key, and body", () => {
  const existing = {
    conversationId: 12,
    senderId: 7,
    clientRequestId: "0c708e8d-6daf-4d7f-8d5b-2e7be32fd12d",
    body: "Gate C needs attention",
  };
  assert.equal(isExactMessageReplay(existing, { ...existing, clientRequestId: existing.clientRequestId! }), true);
  assert.equal(
    isExactMessageReplay(existing, {
      ...existing,
      clientRequestId: existing.clientRequestId!,
      body: "Changed text",
    }),
    false,
  );
  assert.equal(
    isExactMessageReplay(existing, {
      ...existing,
      clientRequestId: existing.clientRequestId!,
      conversationId: 13,
    }),
    false,
  );
});

test("accepted deliveries become terminal and record acceptance time", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  assert.deepEqual(
    outboxTransitionForResult({
      result: { status: "accepted", replyAddress: "reply@example.com" },
      attemptCount: 1,
      maxAttempts: 8,
      now,
    }),
    {
      status: "accepted",
      nextAttemptAt: now,
      acceptedAt: now,
      lastError: null,
    },
  );
});

test("temporary failures back off and the final attempt becomes failed", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(20), 15 * 60_000);

  const retrying = outboxTransitionForResult({
    result: { status: "failed", error: "HTTP 503" },
    attemptCount: 2,
    maxAttempts: 3,
    now,
  });
  assert.equal(retrying.status, "retrying");
  assert.equal(retrying.nextAttemptAt.toISOString(), "2026-09-02T12:00:10.000Z");
  assert.equal(retrying.lastError, "HTTP 503");

  const failed = outboxTransitionForResult({
    result: { status: "failed", error: "HTTP 503" },
    attemptCount: 3,
    maxAttempts: 3,
    now,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.nextAttemptAt, now);
});

test("configuration failures are explicit terminal states rather than fake queues", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  for (const status of ["disabled", "not_configured"] as const) {
    const transition = outboxTransitionForResult({
      result: { status },
      attemptCount: 1,
      maxAttempts: 8,
      now,
    });
    assert.equal(transition.status, status);
    assert.match(transition.lastError ?? "", /disabled|not configured/);
  }
});
