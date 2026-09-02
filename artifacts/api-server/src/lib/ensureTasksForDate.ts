import { db } from "@workspace/db";
import { tasksTable, areasTable, taskTypesTable, taskExclusionsTable } from "@workspace/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { AREA_SPECIFIC_TASKS, AREAS_REPLACING_DEFAULTS } from "../area-tasks";
import { missingRoutineTaskDefinitions } from "./operationsPolicy";

type TaskQueryExecutor = Pick<typeof db, "select">;

export const FALLBACK_TASKS = [
  "Routine sweep of all levels — remove debris, trash, and litter",
  "Mop and sanitize all floor surfaces — extra attention to high-traffic zones",
  "Deep clean stairwells — scrub landings, steps, and corners",
  "Clean and sanitize elevator cabs — floors, walls, buttons, and tracks",
  "Sanitize all handrails, elevator buttons, and high-touch surfaces",
  "Empty all trash receptacles and replace liners",
  "Spot clean walls, pillars, signs, and partitions",
  "Remove gum, stains, and debris from floor surfaces",
  "Clean entry/exit areas, doors, and glass partitions",
  "Inspect and clean drainage grates and floor drains",
  "Inspect and report any maintenance issues or safety hazards",
  "Final supervisor inspection walk-through and sign-off",
];

async function getActiveTaskTypesWith(
  executor: TaskQueryExecutor,
): Promise<{ taskName: string; taskOrder: number }[]> {
  const types = await executor
    .select({ taskName: taskTypesTable.taskName, taskOrder: taskTypesTable.taskOrder })
    .from(taskTypesTable)
    .where(eq(taskTypesTable.active, true))
    .orderBy(asc(taskTypesTable.taskOrder));

  if (types.length === 0) {
    return FALLBACK_TASKS.map((name, idx) => ({ taskName: name, taskOrder: idx + 1 }));
  }
  return types;
}

export async function getActiveTaskTypes(): Promise<{ taskName: string; taskOrder: number }[]> {
  return getActiveTaskTypesWith(db);
}

export async function getAreaSpecificTasks(area: { name: string; terminal: string }): Promise<{ taskName: string; taskOrder: number }[]> {
  const qualifiedKey = `${area.terminal}::${area.name}`;
  return AREA_SPECIFIC_TASKS[qualifiedKey] ?? AREA_SPECIFIC_TASKS[area.name] ?? [];
}

async function getEffectiveTasksForAreaWith(
  executor: TaskQueryExecutor,
  areaId: number,
): Promise<{ taskName: string; taskOrder: number }[]> {
  const [area] = await executor
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, areaId));
  if (!area) return [];

  const qualifiedKey = `${area.terminal}::${area.name}`;
  const replacesDefaults = AREAS_REPLACING_DEFAULTS.has(qualifiedKey);

  const activeTypes = replacesDefaults
    ? []
    : await getActiveTaskTypesWith(executor);
  const extraTasks = await getAreaSpecificTasks(area);
  const allTasks = [...activeTypes, ...extraTasks];

  const exclusions = await executor
    .select({ taskName: taskExclusionsTable.taskName })
    .from(taskExclusionsTable)
    .where(eq(taskExclusionsTable.areaId, areaId));
  const excluded = new Set(exclusions.map((e) => e.taskName));

  return allTasks.filter((t) => !excluded.has(t.taskName));
}

export async function getEffectiveTasksForArea(areaId: number): Promise<{ taskName: string; taskOrder: number }[]> {
  return getEffectiveTasksForAreaWith(db, areaId);
}

export async function ensureTasksForDate(areaId: number, date: string) {
  await db.transaction(async (tx) => {
    // Serialize generation for this area/day. Without a database uniqueness
    // constraint, concurrent first loads could otherwise create duplicates.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`task-sheet:${areaId}:${date}`}))`,
    );

    const allTasks = await getEffectiveTasksForAreaWith(tx, areaId);
    if (allTasks.length === 0) return;

    const existing = await tx
      .select({
        taskName: tasksTable.taskName,
        isSpecial: tasksTable.isSpecial,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.areaId, areaId),
          eq(tasksTable.taskDate, date),
        ),
      );
    const missing = missingRoutineTaskDefinitions(allTasks, existing);
    if (missing.length === 0) return;

    await tx.insert(tasksTable).values(
      missing.map((task) => ({
        areaId,
        taskDate: date,
        taskName: task.taskName,
        taskOrder: task.taskOrder,
        completed: false,
        isSpecial: false,
      })),
    );
  });
}
