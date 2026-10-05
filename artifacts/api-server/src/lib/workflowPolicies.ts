export type ActorPolicy = { id: number; role: "staff" | "supervisor" | "admin" | "inspector" };

export function canMutateTask(actor: ActorPolicy, assignedToId: number | null, inspectorLinked: boolean): boolean {
  if (inspectorLinked) return assignedToId === actor.id;
  return assignedToId === actor.id || actor.role === "supervisor" || actor.role === "admin";
}

export function canManageAssignments(actor: ActorPolicy): boolean {
  return actor.role === "supervisor" || actor.role === "admin";
}

export function isAssignmentTargetEligible(target: { active: boolean; loginEnabled: boolean; formerEmployee: boolean }): boolean {
  return target.active && target.loginEnabled && !target.formerEmployee;
}

export function canReadPrivateObject(input: {
  actor: ActorPolicy;
  ownerStaffId: number | null;
  assignedTaskStaffId?: number | null;
  conversationParticipantIds?: readonly number[];
}): boolean {
  return input.actor.role === "admin" ||
    input.ownerStaffId === input.actor.id ||
    input.assignedTaskStaffId === input.actor.id ||
    Boolean(input.conversationParticipantIds?.includes(input.actor.id));
}

export function formerEmployeeUpdateAllowed(input: {
  formerEmployee: boolean;
  currentName: string;
  requestedName?: string;
  requestedActive?: boolean;
  requestedLoginEnabled?: boolean;
}): boolean {
  if (!input.formerEmployee) return true;
  return input.requestedName === undefined && input.requestedActive !== true && input.requestedLoginEnabled !== true;
}

export const inspectorSweepEligible = (dueAt: Date, now: Date) => dueAt.getTime() <= now.getTime();
export const bulkCompletionEligible = (inspectorLinked: boolean) => !inspectorLinked;

export function objectPurposeMatchesAttachment(purpose: string, slot: "before" | "after", taskId: number | null, expectedTaskId: number): boolean {
  return taskId === expectedTaskId && purpose === (slot === "before" ? "task_before" : "task_after");
}