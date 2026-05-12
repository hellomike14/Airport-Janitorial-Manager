import { db } from "@workspace/db";
import { tasksTable, areasTable, taskTypesTable, taskExclusionsTable } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { AREA_SPECIFIC_TASKS } from "../area-tasks";

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

export async function getActiveTaskTypes(): Promise<{ taskName: string; taskOrder: number }[]> {
  const types = await db
    .select({ taskName: taskTypesTable.taskName, taskOrder: taskTypesTable.taskOrder })
    .from(taskTypesTable)
    .where(eq(taskTypesTable.active, true))
    .orderBy(asc(taskTypesTable.taskOrder));

  if (types.length === 0) {
    return FALLBACK_TASKS.map((name, idx) => ({ taskName: name, taskOrder: idx + 1 }));
  }
  return types;
}

export async function getAreaSpecificTasks(area: { name: string; terminal: string }): Promise<{ taskName: string; taskOrder: number }[]> {
  const qualifiedKey = `${area.terminal}::${area.name}`;
  return AREA_SPECIFIC_TASKS[qualifiedKey] ?? AREA_SPECIFIC_TASKS[area.name] ?? [];
}

export async function getEffectiveTasksForArea(areaId: number): Promise<{ taskName: string; taskOrder: number }[]> {
  const [area] = await db
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, areaId));
  if (!area) return [];

  const activeTypes = await getActiveTaskTypes();
  const extraTasks = await getAreaSpecificTasks(area);
  const allTasks = [...activeTypes, ...extraTasks];

  const exclusions = await db
    .select({ taskName: taskExclusionsTable.taskName })
    .from(taskExclusionsTable)
    .where(eq(taskExclusionsTable.areaId, areaId));
  const excluded = new Set(exclusions.map((e) => e.taskName));

  return allTasks.filter((t) => !excluded.has(t.taskName));
}

export async function ensureTasksForDate(areaId: number, date: string) {
  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.areaId, areaId), eq(tasksTable.taskDate, date)))
    .limit(1);

  if (existing.length === 0) {
    const allTasks = await getEffectiveTasksForArea(areaId);
    if (allTasks.length === 0) return;

    await db.insert(tasksTable).values(
      allTasks.map((t) => ({
        areaId,
        taskDate: date,
        taskName: t.taskName,
        taskOrder: t.taskOrder,
        completed: false,
        isSpecial: false,
      }))
    );
  }
}
