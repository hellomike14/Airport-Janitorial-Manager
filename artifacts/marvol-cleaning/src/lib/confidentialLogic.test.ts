import assert from "node:assert/strict";
import { test } from "vitest";
import { cooldownMsLeft, isSensitiveKey, isValidCode, mayRenderPrivate, unlockedMsLeft } from "./confidentialLogic";

const st = (o: object) => ({ configured: true, unlocked: true, expiresAt: "2025-01-01T00:30:00Z", lockedUntil: null, serverTime: "2025-01-01T00:00:00Z", ...o });
test("code format 8-12 digits", () => {
  assert.equal(isValidCode("1234567"), false); assert.equal(isValidCode("12345678"), true);
  assert.equal(isValidCode("1234567890123"), false); assert.equal(isValidCode("1234abcd9"), false);
});
test("unlock expires by server clock despite client skew", () => {
  assert.equal(unlockedMsLeft(st({}), 5000, 5000), 1800000);
  assert.equal(unlockedMsLeft(st({}), 5000, 5000 + 1800000), 0);
  assert.equal(unlockedMsLeft(st({ unlocked: false }), 0, 0), 0);
  assert.equal(unlockedMsLeft(null, 0, 0), 0);
});
test("cooldown counts down", () => {
  assert.equal(cooldownMsLeft(st({ lockedUntil: "2025-01-01T00:15:00Z" }), 0, 60000), 840000);
  assert.equal(cooldownMsLeft(st({}), 0, 0), 0);
});
test("non-admin never renders private views; role change/expiry lock", () => {
  for (const r of ["supervisor", "staff", "inspector"]) assert.equal(mayRenderPrivate(r, st({}), 0, 0), false);
  assert.equal(mayRenderPrivate("admin", st({}), 0, 0), true);
  assert.equal(mayRenderPrivate("admin", st({}), 0, 1800000), false);
  assert.equal(mayRenderPrivate("admin", st({ configured: true, unlocked: false }), 0, 0), false);
});
test("sensitive query keys are purged", () => {
  assert.equal(isSensitiveKey(["/api/staff/confidential"]), true);
  assert.equal(isSensitiveKey(["/api/quickbooks/status"]), true);
  assert.equal(isSensitiveKey(["/api/auth-diagnostics"]), true);
  assert.equal(isSensitiveKey(["/api/staff"]), false);
  assert.equal(isSensitiveKey(["/api/staff/former"]), true);
  assert.equal(isSensitiveKey(["/api/applications", { status: "new" }]), true);
  assert.equal(isSensitiveKey(["/api/employment-form-submissions"]), true);
  assert.equal(isSensitiveKey(["operations", 7, "/petty-cash"]), true);
  assert.equal(isSensitiveKey(["operations", 7, "/uniform-stock/transactions"]), true);
  assert.equal(isSensitiveKey(["operations", 7, "/supplies"]), false);
  assert.equal(isSensitiveKey(["/api/photo-share/photos"]), false);
});
