export type StaffRole = "admin" | "supervisor" | "inspector" | "staff";

export type StaffActor = {
  id: number;
  role: StaffRole;
};

export type AlertTargetRole = "supervisor" | "staff" | "all";

/**
 * Client-provided staff ids are compatibility hints only. Identity-sensitive
 * routes must reject a conflicting id and use the verified session actor.
 */
export function requestedStaffIdMatchesActor(
  actor: StaffActor,
  requestedStaffId: number | undefined,
): boolean {
  return requestedStaffId === undefined || requestedStaffId === actor.id;
}

/** Precise staff location history is restricted to the admin tracking UI. */
export function canViewStaffLocations(actor: StaffActor): boolean {
  return actor.role === "admin";
}

/** Photo owners may remove their upload; managers may remove any shared photo. */
export function canDeleteSharedPhoto(actor: StaffActor, ownerStaffId: number): boolean {
  return (
    actor.id === ownerStaffId ||
    actor.role === "admin" ||
    actor.role === "supervisor"
  );
}

/**
 * Returns the roles an alert may reach. Staff and supervisors can alert the
 * management group only; admins and inspectors can choose the wider audience.
 */
export function alertRecipientRoles(
  sender: StaffActor,
  targetRole: AlertTargetRole,
): StaffRole[] {
  if (sender.role === "admin" || sender.role === "inspector") {
    if (targetRole === "staff") return ["staff"];
    if (targetRole === "all") return ["admin", "supervisor", "staff"];
    return ["admin", "supervisor"];
  }

  return ["admin", "supervisor"];
}
