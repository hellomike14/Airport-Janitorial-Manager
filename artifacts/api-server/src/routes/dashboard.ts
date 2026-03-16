import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, areasTable, issuesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { GetDashboardQueryParams } from "@workspace/api-zod";

const DAILY_TASKS = [
  "Sweep and mop all floors",
  "Clean and sanitize all restrooms",
  "Empty and replace all trash bins",
  "Wipe down counters and surfaces",
  "Clean glass doors and windows",
  "Sanitize handrails and touch points",
  "Check and restock supplies (soap, paper)",
  "Clean elevators and escalator treads",
  "Spot clean walls and partitions",
  "Clean food court and seating areas",
  "Vacuum all carpeted areas",
  "Clean gates and passenger waiting areas",
  "Inspect and clean baggage claim area",
  "Report and tag any maintenance issues",
  "Final supervisor inspection walk-through",
];

async function ensureTasksForDate(areaId: number, date: string) {
  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      sql`${tasksTable.areaId} = ${areaId} AND ${tasksTable.taskDate} = ${date}`
    )
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

export default router;
