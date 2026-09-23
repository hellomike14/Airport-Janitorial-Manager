import assert from "node:assert/strict";
import test from "node:test";
import {
  loginEnabledAfterAdminUpdate,
  loginEnabledAfterSeedReconciliation,
} from "./staffLoginPolicy";
import { SEED_STAFF } from "../seed-data";

const activeStaff = {
  active: true,
  loginEnabled: false,
  formerEmployee: false,
  email: "current@example.test",
};

test("admin saving a nonempty email enables login only for active current staff", () => {
  assert.equal(loginEnabledAfterAdminUpdate(activeStaff, { email: " new@example.test " }), true);
  assert.equal(loginEnabledAfterAdminUpdate({ ...activeStaff, active: false }, { email: "new@example.test" }), false);
  assert.equal(loginEnabledAfterAdminUpdate({ ...activeStaff, formerEmployee: true }, { email: "new@example.test" }), false);
});

test("blank email, deactivation, and inactive reactivation preserve safe login policy", () => {
  assert.equal(loginEnabledAfterAdminUpdate({ ...activeStaff, loginEnabled: true }, { email: " " }), false);
  assert.equal(loginEnabledAfterAdminUpdate({ ...activeStaff, loginEnabled: true }, { active: false }), false);
  assert.equal(
    loginEnabledAfterAdminUpdate({ ...activeStaff, active: false, loginEnabled: false }, { active: true }),
    false,
  );
  assert.equal(
    loginEnabledAfterAdminUpdate(
      { ...activeStaff, active: false, loginEnabled: false },
      { active: true, email: "current@example.test" },
    ),
    true,
  );
});

test("seed reconciliation preserves administrator login choices unless safety or an explicit opt-out disables them", () => {
  assert.equal(loginEnabledAfterSeedReconciliation({
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  }), true);
  assert.equal(loginEnabledAfterSeedReconciliation({
    active: true,
    loginEnabled: false,
    formerEmployee: false,
    seedLoginEnabled: true,
  }), false);
  assert.equal(loginEnabledAfterSeedReconciliation({
    active: true,
    loginEnabled: true,
    formerEmployee: false,
    seedLoginEnabled: false,
  }), false);
  assert.equal(loginEnabledAfterSeedReconciliation({
    active: true,
    loginEnabled: true,
    formerEmployee: true,
  }), false);
  assert.equal(loginEnabledAfterSeedReconciliation({
    active: false,
    loginEnabled: true,
    formerEmployee: false,
  }), false);
});

test("Jean Gardy and Kevin keep an administrator-enabled login when their seeds have no login identity", () => {
  for (const name of ["Jean Gardy Rigueur", "Kevin Gonzalez Fernandez"]) {
    const seed = SEED_STAFF.find((entry) => entry.name === name);
    assert.ok(seed);
    assert.equal(seed.email, undefined);
    assert.equal(loginEnabledAfterSeedReconciliation({
      active: true,
      loginEnabled: true,
      formerEmployee: false,
      seedLoginEnabled: seed.loginEnabled,
    }), true);
  }
});