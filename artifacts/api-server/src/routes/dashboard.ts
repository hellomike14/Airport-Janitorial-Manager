import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, areasTable, issuesTable, assignmentsTable, staffTable, taskTypesTable } from "@workspace/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { GetDashboardQueryParams } from "@workspace/api-zod";
import { AREA_SPECIFIC_TASKS } from "../area-tasks";

const FALLBACK_TASKS = [
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

async function getActiveTaskTypes(): Promise<{ taskName: string; taskOrder: number }[]> {
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

async function ensureTasksForDate(areaId: number, date: string) {
  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.areaId, areaId), eq(tasksTable.taskDate, date)))
    .limit(1);

  if (existing.length === 0) {
    const activeTypes = await getActiveTaskTypes();

    const [area] = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, areaId));
    const extraTasks = area ? (AREA_SPECIFIC_TASKS[area.name] ?? []) : [];
    const allTasks = [...activeTypes, ...extraTasks];

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

const router: IRouter = Router();

router.get("/dashboard", async (req, res) => {
  const query = GetDashboardQueryParams.parse({ date: req.query.date });
  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;

  const areas = await db.select().from(areasTable).orderBy(areasTable.sortOrder);

  for (const area of areas) {
    await ensureTasksForDate(area.id, date);
  }

  const taskStats = await db
    .select({
      areaId: tasksTable.areaId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.taskDate, date))
    .groupBy(tasksTable.areaId);

  const statsMap = new Map(taskStats.map((s) => [s.areaId, s]));

  const totalTasks = taskStats.reduce((sum, s) => sum + s.total, 0);
  const completedTasks = taskStats.reduce((sum, s) => sum + s.completed, 0);

  const issueCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issuesTable)
    .where(eq(issuesTable.resolved, false));

  const dayAssignments = await db
    .select({
      areaId: assignmentsTable.areaId,
      staffName: staffTable.name,
    })
    .from(assignmentsTable)
    .innerJoin(
      staffTable,
      and(eq(assignmentsTable.staffId, staffTable.id), eq(staffTable.active, true))
    )
    .where(eq(assignmentsTable.assignmentDate, date));

  const assignmentsByArea = new Map<number, string[]>();
  for (const a of dayAssignments) {
    const list = assignmentsByArea.get(a.areaId) ?? [];
    list.push(a.staffName);
    assignmentsByArea.set(a.areaId, list);
  }

  const areaProgress = areas.map((area) => {
    const stats = statsMap.get(area.id) ?? { total: 15, completed: 0 };
    return {
      areaId: area.id,
      areaName: area.name,
      terminal: area.terminal,
      totalTasks: stats.total,
      completedTasks: stats.completed,
      percentage:
        stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
      assignedStaff: assignmentsByArea.get(area.id) ?? [],
    };
  });

  const completedAreas = areaProgress.filter((a) => a.percentage === 100).length;

  res.json({
    date,
    totalTasks,
    completedTasks,
    totalAreas: areas.length,
    completedAreas,
    openIssues: issueCount[0]?.count ?? 0,
    areaProgress,
  });
});

export default router;
