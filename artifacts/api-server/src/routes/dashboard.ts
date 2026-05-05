import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, areasTable, issuesTable, assignmentsTable, staffTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { GetDashboardQueryParams } from "@workspace/api-zod";
import { ensureTasksForDate } from "../lib/ensureTasksForDate";

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
