import assert from "node:assert/strict";
import test from "node:test";
import { findSeedStaffIdentity } from "./seedStaffIdentity";

test("adding HR administrators or inspectors never claims the seeded owner identity", () => {
  const seeds = [{ name: "Seed owner", role: "admin", email: "seed-owner@example.invalid" }];
  assert.equal(findSeedStaffIdentity({ name: "Different HR administrator", role: "admin", email: "different@example.invalid" }, seeds), undefined);
  assert.equal(findSeedStaffIdentity({ name: "Another admin", role: "admin" }, seeds), undefined);
  assert.equal(findSeedStaffIdentity({ name: "Existing owner alias", role: "admin", email: " SEED-OWNER@example.invalid " }, seeds), seeds[0]);
  assert.equal(findSeedStaffIdentity({ name: "Seed owner", role: "admin" }, seeds), seeds[0]);
});
