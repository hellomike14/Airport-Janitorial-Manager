import assert from "node:assert/strict";
import test from "node:test";
import { selectCanonicalStaffRecord } from "./startupStaffReconciliation";

test("keeps the row already carrying the canonical Clerk email", () => {
  const canonical = selectCanonicalStaffRecord(
    [
      { id: 1, email: "old@example.com", active: true, loginEnabled: true },
      {
        id: 9,
        email: " Inspector@MarvolEnterprises.com ",
        active: true,
        loginEnabled: false,
      },
    ],
    "inspector@marvolenterprises.com",
  );

  assert.equal(canonical?.id, 9);
});

test("uses active login state and id as deterministic fallbacks", () => {
  const canonical = selectCanonicalStaffRecord([
    { id: 8, email: null, active: true, loginEnabled: true },
    { id: 3, email: null, active: true, loginEnabled: true },
    { id: 1, email: null, active: false, loginEnabled: false },
  ]);

  assert.equal(canonical?.id, 3);
});
