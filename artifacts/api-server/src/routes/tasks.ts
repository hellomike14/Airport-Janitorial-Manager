import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, staffTable, areasTable, issuesTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  ListTasksQueryParams,
  CompleteTaskParams,
  CompleteTaskBody,
  UncompleteTaskParams,
  CompleteAllTasksBody,
  GetDashboardQueryParams,
} from "@workspace/api-zod";

const DAILY_TASKS = [
  "Routine sweep of all levels — remove debris, trash, and litter",
  "Mop and sanitize all floor surfaces — extra attention to high-traffic zones",
  "Deep clean stairwells — scrub landings, steps, and corners",
  "Clean and sanitize elevator cabs — floors, walls, buttons, and tracks",
  "Sanitize all handrails, elevator buttons, and high-touch surfaces",
  "Empty all trash receptacles and replace liners",
  "Clean and sanitize restroom facilities — restock soap, paper, and supplies",
  "Spot clean walls, pillars, signs, and partitions",
  "Remove gum, stains, and debris from floor surfaces",
  "Clean entry/exit areas, doors, and glass partitions",
  "Inspect and clean drainage grates and floor drains",
  "Clean gate/seating areas — wipe seats, armrests, and surfaces",
  "Sweep and clean ticketing kiosks, counters, and service areas",
  "Inspect and report any maintenance issues or safety hazards",
  "Final supervisor inspection walk-through and sign-off",
];

const router: IRouter = Router();

async function ensureTasksForDate(areaId: number, date: string) {
  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.areaId, areaId), eq(tasksTable.taskDate, date)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(tasksTable).values(
      DAILY_TASKS.map((name, idx) => ({
        areaId,
        taskDate: date,
        taskName: name,
        taskOrder: idx + 1,
        completed: false,
        isSpecial: false,
      }))
    );
  }
}

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

  const areaProgress = areas.map((area) => {
    const stats = statsMap.get(area.id) ?? { total: 15, completed: 0 };
    return {
      areaId: area.id,
      areaName: area.name,
      terminal: area.terminal,
      totalTasks: stats.total,
      completedTasks: stats.completed,
      percentage: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
      assignedStaff: [] as string[],
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

router.get("/", async (req, res) => {
  const query = ListTasksQueryParams.parse({
    areaId: req.query.areaId,
    date: req.query.date,
  });

  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;
  const areaId = query.areaId;

  if (areaId) {
    await ensureTasksForDate(areaId, date);
  }

  const tasks = await db
    .select({
      id: tasksTable.id,
      areaId: tasksTable.areaId,
      taskDate: tasksTable.taskDate,
      taskName: tasksTable.taskName,
      taskOrder: tasksTable.taskOrder,
      completed: tasksTable.completed,
      completedAt: tasksTable.completedAt,
      completedById: tasksTable.completedById,
      completedByName: staffTable.name,
      assignedToId: tasksTable.assignedToId,
      isSpecial: tasksTable.isSpecial,
      notes: tasksTable.notes,
    })
    .from(tasksTable)
    .leftJoin(staffTable, eq(tasksTable.completedById, staffTable.id))
    .where(
      and(
        eq(tasksTable.taskDate, date),
        areaId ? eq(tasksTable.areaId, areaId) : undefined
      )
    )
    .orderBy(tasksTable.areaId, tasksTable.taskOrder);

  res.json(
    tasks.map((t) => ({
      ...t,
      completedAt: t.completedAt?.toISOString() ?? null,
      assignedToName: null,
    }))
  );
});

router.post("/complete-all", async (req, res) => {
  const body = CompleteAllTasksBody.parse(req.body);
  await ensureTasksForDate(body.areaId, body.date);

  const result = await db
    .update(tasksTable)
    .set({
      completed: true,
      completedAt: new Date(),
      completedById: body.completedById,
    })
    .where(
      and(
        eq(tasksTable.areaId, body.areaId),
        eq(tasksTable.taskDate, body.date),
        eq(tasksTable.completed, false)
      )
    );

  res.json({ updated: (result as any).rowCount ?? 0 });
});

router.post("/:id/complete", async (req, res) => {
  const { id } = CompleteTaskParams.parse({ id: req.params.id });
  const body = CompleteTaskBody.parse(req.body);

  const [updated] = await db
    .update(tasksTable)
    .set({
      completed: true,
      completedAt: new Date(),
      completedById: body.completedById,
    })
    .where(eq(tasksTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const staffMember = updated.completedById
    ? await db
        .select({ name: staffTable.name })
        .from(staffTable)
        .where(eq(staffTable.id, updated.completedById))
        .then((r) => r[0])
    : null;

  res.json({
    ...updated,
    taskDate: updated.taskDate,
    completedAt: updated.completedAt?.toISOString() ?? null,
    completedByName: staffMember?.name ?? null,
    assignedToName: null,
  });
});

router.post("/:id/uncomplete", async (req, res) => {
  const { id } = UncompleteTaskParams.parse({ id: req.params.id });

  const [updated] = await db
    .update(tasksTable)
    .set({
      completed: false,
      completedAt: null,
      completedById: null,
    })
    .where(eq(tasksTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({
    ...updated,
    taskDate: updated.taskDate,
    completedAt: null,
    completedByName: null,
    assignedToName: null,
  });
});

export { ensureTasksForDate };
export default router;
