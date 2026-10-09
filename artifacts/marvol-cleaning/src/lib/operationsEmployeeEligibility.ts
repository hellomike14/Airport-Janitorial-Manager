import type { StaffOption } from "@/lib/operationsApi";

const eligibleRoles = new Set(["staff", "supervisor", "admin"]);

export function isEligibleOperationsAssignee(
  employee: Pick<StaffOption, "active" | "formerEmployee" | "role">,
) {
  return employee.active === true &&
    employee.formerEmployee !== true &&
    eligibleRoles.has(employee.role);
}

export function eligibleOperationsAssignees(staff: readonly StaffOption[]) {
  return staff.filter(isEligibleOperationsAssignee);
}
