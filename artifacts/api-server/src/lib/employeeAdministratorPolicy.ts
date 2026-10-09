type StaffTarget = {
  id: number;
  role: string;
  formerEmployee: boolean;
};

export function employeeAdministratorCanCreateRole(role: string) {
  return role === "staff";
}

export function employeeAdministratorCanUpdateTarget(
  actorId: number,
  target: StaffTarget,
  requestedRole: string | undefined,
) {
  return actorId !== target.id &&
    target.role === "staff" &&
    !target.formerEmployee &&
    requestedRole === undefined;
}
