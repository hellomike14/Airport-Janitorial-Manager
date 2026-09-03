import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidMessageRecipientIds,
  isMessageRecipientEligible,
  type MessageRecipientCandidate,
} from "./messageRecipientPolicy";

function candidate(
  overrides: Partial<MessageRecipientCandidate> = {},
): MessageRecipientCandidate {
  return {
    id: 1,
    active: true,
    loginEnabled: true,
    email: "staff@example.com",
    ...overrides,
  };
}

test("permits only active, login-enabled app identities", () => {
  assert.equal(isMessageRecipientEligible(candidate()), true);
  assert.equal(isMessageRecipientEligible(candidate({ active: false })), false);
  assert.equal(isMessageRecipientEligible(candidate({ loginEnabled: false })), false);
  assert.equal(isMessageRecipientEligible(candidate({ email: null })), false);
  assert.equal(isMessageRecipientEligible(candidate({ email: "   " })), false);
});

test("excludes the notification-only address from conversations", () => {
  assert.equal(
    isMessageRecipientEligible(
      candidate({ email: " MSUTHERLAND@marvolenterprises.com " }),
    ),
    false,
  );
});

test("reports missing and ineligible group recipients without duplicates", () => {
  const invalid = invalidMessageRecipientIds(
    [2, 3, 4, 4, 5],
    [
      candidate({ id: 2 }),
      candidate({ id: 3, active: false }),
      candidate({ id: 4, loginEnabled: false }),
    ],
  );
  assert.deepEqual(invalid, [3, 4, 5]);
});
