import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleOperationsStaff,
  isEligibleOperationsEmployee,
} from "./operationsPolicy";

test("operations eligibility requires active non-former employee roles", () => {
  for (const role of ["staff", "supervisor", "admin"] as const) {
    assert.equal(
      isEligibleOperationsEmployee({
        active: true,
        formerEmployee: false,
        role,
      }),
      true,
    );
  }

  assert.equal(
    isEligibleOperationsEmployee({
      active: true,
      formerEmployee: undefined,
      role: "staff",
    }),
    true,
  );
  assert.equal(
    isEligibleOperationsEmployee({
      active: false,
      formerEmployee: false,
      role: "staff",
    }),
    false,
  );
  assert.equal(
    isEligibleOperationsEmployee({
      active: true,
      formerEmployee: true,
      role: "staff",
    }),
    false,
  );
  assert.equal(
    isEligibleOperationsEmployee({
      active: true,
      formerEmployee: false,
      role: "inspector",
    }),
    false,
  );
  assert.equal(
    isEligibleOperationsEmployee({
      active: true,
      formerEmployee: false,
      role: "applicant",
    }),
    false,
  );

  const eligibleIds = eligibleOperationsStaff([
    { id: 1, active: true, formerEmployee: false, role: "staff" },
    { id: 2, active: true, role: "supervisor" },
    { id: 3, active: false, formerEmployee: false, role: "admin" },
    { id: 4, active: true, formerEmployee: true, role: "staff" },
    { id: 5, active: true, formerEmployee: false, role: "inspector" },
  ]).map(({ id }) => id);
  assert.deepEqual(eligibleIds, [1, 2]);
});
