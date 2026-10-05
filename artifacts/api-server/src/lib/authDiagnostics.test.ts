import assert from "node:assert/strict";
import test from "node:test";
import {
  accessChangeValues,
  accessSnapshot,
  FixedWindowRateLimiter,
  isClientDiagnosticCode,
  isServerDiagnosticCode,
} from "./authDiagnostics";

test("diagnostics accept only explicit safe codes", () => {
  assert.equal(isClientDiagnosticCode("AUTH_SERVICE_UNAVAILABLE"), true);
  assert.equal(isClientDiagnosticCode("STAFF_LOOKUP_TIMEOUT"), true);
  assert.equal(isClientDiagnosticCode("NO_STAFF_MATCH"), false);
  assert.equal(isClientDiagnosticCode("user@example.test"), false);
  assert.equal(isServerDiagnosticCode("SESSION_EXPIRED"), true);
  assert.equal(isServerDiagnosticCode("provider said token=secret"), false);
});

test("unauthenticated diagnostic ingestion is bounded and resets by window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.equal(limiter.take(10), true);
  assert.equal(limiter.take(11), true);
  assert.equal(limiter.take(12), false);
  assert.equal(limiter.take(1_010), true);
});

test("staff access audit contains booleans and names but never email values", () => {
  const before = accessSnapshot({
    active: true,
    loginEnabled: true,
    formerEmployee: false,
    email: "sensitive@example.test",
  });
  const values = accessChangeValues({
    actor: { id: 1, name: "Admin" },
    staff: { id: 2, name: "Staff" },
    action: "UPDATE",
    before,
    after: { ...before, loginEnabled: false },
  });
  assert.equal(values.beforeHasEmail, true);
  assert.equal(values.afterLoginEnabled, false);
  assert.equal(JSON.stringify(values).includes("sensitive@example.test"), false);
  assert.equal("email" in values, false);
});