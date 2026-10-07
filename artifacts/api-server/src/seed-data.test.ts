import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_STAFF_NAMES, SEED_STAFF, isSeedLoginEnabled } from "./seed-data";

test("removed identities are distinct from current seed identities", () => {
  for (const name of REMOVED_STAFF_NAMES) {
    assert.equal(SEED_STAFF.some((staff) => staff.name === name), false, `${name} must not be reseeded`);
  }
});

test("Edner is no longer forced inactive during startup reconciliation", () => {
  assert.equal(REMOVED_STAFF_NAMES.includes("Edner Jules"), false);
  // Restore the existing record, rather than reseeding a replacement identity.
  assert.equal(SEED_STAFF.some((staff) => staff.name === "Edner Jules"), false);
});

test("Alexis remains removed and cannot be reseeded as active staff", () => {
  assert.equal(REMOVED_STAFF_NAMES.includes("Alexis Moron"), true);
  assert.equal(SEED_STAFF.some((staff) => staff.name === "Alexis Moron"), false);
});

test("Diego remains removed and cannot be reseeded as active staff", () => {
  assert.equal(REMOVED_STAFF_NAMES.includes("Diego Moreno Velez"), true);
  assert.equal(SEED_STAFF.some((staff) => staff.name === "Diego Moreno Velez"), false);
});

test("Jose Camargo remains former and cannot be restored by staff defaults", () => {
  assert.equal(REMOVED_STAFF_NAMES.includes("Jose Camargo"), true);
  assert.equal(SEED_STAFF.some((staff) => staff.name === "Jose Camargo"), false);
});

test("only explicitly seeded email identities have login enabled by default", () => {
  for (const staff of SEED_STAFF) {
    assert.equal(
      isSeedLoginEnabled(staff),
      staff.loginEnabled !== false && Boolean(staff.email?.trim()),
    );
  }
  assert.equal(isSeedLoginEnabled({ name: "legacy", role: "staff" }), false);
  assert.equal(isSeedLoginEnabled({ name: "disabled", role: "staff", email: "x@example.test", loginEnabled: false }), false);
});

test("Jean Gardy and Kevin seeds do not override administrator-managed login identity or status", () => {
  for (const name of ["Jean Gardy Rigueur", "Kevin Gonzalez Fernandez"]) {
    const staff = SEED_STAFF.find((entry) => entry.name === name);
    assert.ok(staff);
    assert.equal(staff.email, undefined);
    assert.equal(staff.loginEnabled, undefined);
  }
});
