import { describe, expect, it } from "vitest";
import {
  eligibleOperationsAssignees,
  isEligibleOperationsAssignee,
} from "./operationsEmployeeEligibility";
import type { StaffOption } from "./operationsApi";

const employee = (
  id: number,
  role: StaffOption["role"],
  active: boolean,
  formerEmployee: boolean,
) =>
  ({
    id,
    role,
    active,
    formerEmployee,
    name: `Employee ${id}`,
  }) as StaffOption;

describe("operations employee selectors", () => {
  it("only includes active, non-former staff, supervisors and administrators", () => {
    const eligible = eligibleOperationsAssignees([
      employee(1, "staff", true, false),
      employee(2, "supervisor", true, false),
      employee(3, "admin", true, false),
      employee(4, "staff", false, false),
      employee(5, "staff", true, true),
      employee(6, "inspector", true, false),
    ]);
    expect(eligible.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(
      isEligibleOperationsAssignee({
        active: true,
        formerEmployee: undefined as unknown as boolean,
        role: "staff",
      }),
    ).toBe(true);
  });
});
