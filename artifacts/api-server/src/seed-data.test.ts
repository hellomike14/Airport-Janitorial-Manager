import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_STAFF_NAMES, SEED_STAFF, isSeedLoginEnabled } from "./seed-data";

test("removed identities are distinct from current seed identities", () => {
  for (const name of REMOVED_STAFF_NAMES) {
    assert.equal(SEED_STAFF.some((staff) => staff.name === name), false, `${name} must not be reseeded`);
  }
});

test("only explicitly seeded email identities have login enabled by default", () => {
  for (const staff of SEED_STAFF) {
    assert.equal(isSeedLoginEnabled(staff), Boolean(staff.email?.trim()));
  }
  assert.equal(isSeedLoginEnabled({ name: "legacy", role: "staff" }), false);
  assert.equal(isSeedLoginEnabled({ name: "disabled", role: "staff", email: "x@example.test", loginEnabled: false }), false);
});