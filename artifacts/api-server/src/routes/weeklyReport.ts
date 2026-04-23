import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  areasTable,
  issuesTable,
  staffTable,
  notificationsTable,
  sharedPhotosTable,
  assignmentsTable,
} from "@workspace/db/schema";
import { eq, sql, and, gte, lte } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const now = new Date();
    const weekStart = from
      ? String(from)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
          .toISOString()
          .split("T")[0];
    const weekEnd = to
      ? String(to)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 6)
          .toISOString()
          .split("T")[0];

    const taskStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
      })
      .from(tasksTable)
      .where(and(gte(tasksTable.taskDate, weekStart), lte(tasksTable.taskDate, weekEnd)));

    const totalTasks = taskStats[0]?.total ?? 0;
    const completedTasks = taskStats[0]?.completed ?? 0;

    const tasksByDay = await db
      .select({
        date: tasksTable.taskDate,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
      })
      .from(tasksTable)
      .where(and(gte(tasksTable.taskDate, weekStart), lte(tasksTable.taskDate, weekEnd)))
      .groupBy(tasksTable.taskDate)
      .orderBy(tasksTable.taskDate);

    const issueStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        resolved: sql<number>`sum(case when ${issuesTable.resolved} then 1 else 0 end)::int`,
        high: sql<number>`sum(case when ${issuesTable.severity} = 'high' then 1 else 0 end)::int`,
        medium: sql<number>`sum(case when ${issuesTable.severity} = 'medium' then 1 else 0 end)::int`,
        low: sql<number>`sum(case when ${issuesTable.severity} = 'low' then 1 else 0 end)::int`,
      })
      .from(issuesTable)
      .where(and(gte(issuesTable.issueDate, weekStart), lte(issuesTable.issueDate, weekEnd)));

    const totalIssues = issueStats[0]?.total ?? 0;
    const resolvedIssues = issueStats[0]?.resolved ?? 0;
    const highIssues = issueStats[0]?.high ?? 0;
    const mediumIssues = issueStats[0]?.medium ?? 0;
    const lowIssues = issueStats[0]?.low ?? 0;

    const staffProductivity = await db
      .select({
        staffId: tasksTable.completedById,
        staffName: staffTable.name,
        staffRole: staffTable.role,
        tasksCompleted: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .innerJoin(
        staffTable,
        and(eq(tasksTable.completedById, staffTable.id), eq(staffTable.active, true))
      )
      .where(
        and(
          gte(tasksTable.taskDate, weekStart),
          lte(tasksTable.taskDate, weekEnd),
          eq(tasksTable.completed, true)
        )
      )
      .groupBy(tasksTable.completedById, staffTable.name, staffTable.role)
      .orderBy(sql`count(*) desc`);

    const areaPerformance = await db
      .select({
        areaId: tasksTable.areaId,
        areaName: areasTable.name,
        terminal: areasTable.terminal,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
      })
      .from(tasksTable)
      .innerJoin(areasTable, eq(tasksTable.areaId, areasTable.id))
      .where(and(gte(tasksTable.taskDate, weekStart), lte(tasksTable.taskDate, weekEnd)))
      .groupBy(tasksTable.areaId, areasTable.name, areasTable.terminal)
      .orderBy(sql`sum(case when ${tasksTable.completed} then 1 else 0 end)::float / nullif(count(*), 0) desc`);

    const photoCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sharedPhotosTable)
      .where(
        and(
          gte(sharedPhotosTable.createdAt, new Date(weekStart + "T00:00:00Z")),
          lte(sharedPhotosTable.createdAt, new Date(weekEnd + "T23:59:59Z"))
        )
      );

    const alertCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          gte(notificationsTable.createdAt, new Date(weekStart + "T00:00:00Z")),
          lte(notificationsTable.createdAt, new Date(weekEnd + "T23:59:59Z"))
        )
      );

    const issuesByArea = await db
      .select({
        areaName: areasTable.name,
        terminal: areasTable.terminal,
        count: sql<number>`count(*)::int`,
      })
      .from(issuesTable)
      .innerJoin(areasTable, eq(issuesTable.areaId, areasTable.id))
      .where(and(gte(issuesTable.issueDate, weekStart), lte(issuesTable.issueDate, weekEnd)))
      .groupBy(areasTable.name, areasTable.terminal)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const allStaff = await db
      .select({ id: staffTable.id, name: staffTable.name, role: staffTable.role })
      .from(staffTable)
      .where(eq(staffTable.active, true));

    const staffTasksCompleted = await db
      .select({
        staffId: tasksTable.completedById,
        total: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .where(
        and(
          gte(tasksTable.taskDate, weekStart),
          lte(tasksTable.taskDate, weekEnd),
          eq(tasksTable.completed, true)
        )
      )
      .groupBy(tasksTable.completedById);

    const staffSpecialCompleted = await db
      .select({
        staffId: tasksTable.completedById,
        total: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .where(
        and(
          gte(tasksTable.taskDate, weekStart),
          lte(tasksTable.taskDate, weekEnd),
          eq(tasksTable.completed, true),
          eq(tasksTable.isSpecial, true)
        )
      )
      .groupBy(tasksTable.completedById);

    const staffIssuesResolved = await db
      .select({
        staffId: issuesTable.assignedToId,
        total: sql<number>`count(*)::int`,
      })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.resolved, true),
          gte(issuesTable.resolvedAt, new Date(weekStart + "T00:00:00Z")),
          lte(issuesTable.resolvedAt, new Date(weekEnd + "T23:59:59Z"))
        )
      )
      .groupBy(issuesTable.assignedToId);

    const staffIssuesReported = await db
      .select({
        staffId: issuesTable.reportedById,
        total: sql<number>`count(*)::int`,
      })
      .from(issuesTable)
      .where(
        and(
          gte(issuesTable.issueDate, weekStart),
          lte(issuesTable.issueDate, weekEnd)
        )
      )
      .groupBy(issuesTable.reportedById);

    const staffPhotoCount = await db
      .select({
        staffId: sharedPhotosTable.staffId,
        total: sql<number>`count(*)::int`,
      })
      .from(sharedPhotosTable)
      .where(
        and(
          gte(sharedPhotosTable.createdAt, new Date(weekStart + "T00:00:00Z")),
          lte(sharedPhotosTable.createdAt, new Date(weekEnd + "T23:59:59Z"))
        )
      )
      .groupBy(sharedPhotosTable.staffId);

    const staffAreasWorked = await db
      .select({
        staffId: tasksTable.completedById,
        areaCount: sql<number>`count(distinct ${tasksTable.areaId})::int`,
      })
      .from(tasksTable)
      .where(
        and(
          gte(tasksTable.taskDate, weekStart),
          lte(tasksTable.taskDate, weekEnd),
          eq(tasksTable.completed, true)
        )
      )
      .groupBy(tasksTable.completedById);

    const tcMap = new Map(staffTasksCompleted.map((r) => [r.staffId, r.total]));
    const scMap = new Map(staffSpecialCompleted.map((r) => [r.staffId, r.total]));
    const irMap = new Map(staffIssuesResolved.map((r) => [r.staffId, r.total]));
    const rpMap = new Map(staffIssuesReported.map((r) => [r.staffId, r.total]));
    const phMap = new Map(staffPhotoCount.map((r) => [r.staffId, r.total]));
    const awMap = new Map(staffAreasWorked.map((r) => [r.staffId, r.areaCount]));

    const staffBreakdown = allStaff
      .map((s) => ({
        staffId: s.id,
        staffName: s.name,
        staffRole: s.role,
        tasksCompleted: tcMap.get(s.id) ?? 0,
        specialRequestsCompleted: scMap.get(s.id) ?? 0,
        issuesResolved: irMap.get(s.id) ?? 0,
        issuesReported: rpMap.get(s.id) ?? 0,
        photosShared: phMap.get(s.id) ?? 0,
        areasWorked: awMap.get(s.id) ?? 0,
      }))
      .filter((s) => s.tasksCompleted > 0 || s.issuesResolved > 0 || s.issuesReported > 0 || s.photosShared > 0 || s.specialRequestsCompleted > 0)
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted);

    res.json({
      weekStart,
      weekEnd,
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        byDay: tasksByDay,
      },
      issues: {
        total: totalIssues,
        resolved: resolvedIssues,
        open: totalIssues - resolvedIssues,
        resolutionRate: totalIssues > 0 ? Math.round((resolvedIssues / totalIssues) * 100) : 0,
        bySeverity: { high: highIssues, medium: mediumIssues, low: lowIssues },
        byArea: issuesByArea,
      },
      staffProductivity,
      staffBreakdown,
      areaPerformance: areaPerformance.map((a) => ({
        ...a,
        completionRate: a.total > 0 ? Math.round((a.completed / a.total) * 100) : 0,
      })),
      photosShared: photoCount[0]?.count ?? 0,
      notificationsSent: alertCount[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("Weekly report error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
