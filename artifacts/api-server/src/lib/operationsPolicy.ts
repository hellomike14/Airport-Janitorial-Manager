export type RoutineTaskDefinition = {
  taskName: string;
  taskOrder: number;
};

export type ExistingTaskIdentity = {
  taskName: string;
  isSpecial: boolean;
};

export type ScheduleTimes = {
  startTime: string;
  endTime: string;
};

export type ScheduleTimeUpdate = Partial<ScheduleTimes>;

export type ScheduleUpdateValidation =
  | { ok: true; startTime: string; endTime: string }
  | { ok: false; reason: "no_updates" | "invalid_time_order" };

/**
 * A direct task assignment is exclusive. Area membership only grants access
 * to tasks that do not name a specific assignee.
 */
export function canStaffWorkTaskByScope(
  actorId: number,
  assignedToId: number | null,
  hasAreaAssignment: boolean,
): boolean {
  return assignedToId === null
    ? hasAreaAssignment
    : assignedToId === actorId;
}

/**
 * Returns the routine definitions still missing from a generated sheet.
 * Special requests deliberately do not count as routine checklist rows.
 */
export function missingRoutineTaskDefinitions(
  definitions: RoutineTaskDefinition[],
  existingRows: ExistingTaskIdentity[],
): RoutineTaskDefinition[] {
  const present = new Set(
    existingRows
      .filter((row) => !row.isSpecial)
      .map((row) => row.taskName),
  );
  const missing: RoutineTaskDefinition[] = [];

  for (const definition of definitions) {
    if (present.has(definition.taskName)) continue;
    missing.push(definition);
    // Also de-duplicate a malformed definition list before inserting.
    present.add(definition.taskName);
  }

  return missing;
}

/** Validate a partial schedule edit against the complete stored time range. */
export function validateScheduleTimeUpdate(
  current: ScheduleTimes,
  update: ScheduleTimeUpdate,
  hasAnyUpdate: boolean,
): ScheduleUpdateValidation {
  if (!hasAnyUpdate) return { ok: false, reason: "no_updates" };

  const startTime = update.startTime ?? current.startTime;
  const endTime = update.endTime ?? current.endTime;
  if (startTime >= endTime) {
    return { ok: false, reason: "invalid_time_order" };
  }

  return { ok: true, startTime, endTime };
}
