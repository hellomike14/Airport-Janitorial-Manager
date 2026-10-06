import { db } from "@workspace/db";
import {
  tasksTable,
  issuesTable,
  areasTable,
  staffTable,
  timeEntriesTable,
  incidentsTable,
  inspectionsTable,
  monthlyReportsTable,
} from "@workspace/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { monthRange, paidMinutes, previousMonth } from "./operationsPolicy";

/** Separate work records from time records: checklist totals are never payroll hours. */
export async function buildMonthlyReport(month: string) {
  const { from, to } = monthRange(month);
  const [tasks, issues, time, incidents, inspections] = await Promise.all([
    db
      .select({
        areaId: tasksTable.areaId,
        areaName: areasTable.name,
        terminal: areasTable.terminal,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasksTable.completed})::int`,
        photoEvidence: sql<number>`count(*) filter (where ${tasksTable.completed} AND ${tasksTable.afterImagePath} IS NOT NULL)::int`,
      })
      .from(tasksTable)
      .innerJoin(areasTable, eq(tasksTable.areaId, areasTable.id))
      .where(and(gte(tasksTable.taskDate, from), lt(tasksTable.taskDate, to)))
      .groupBy(tasksTable.areaId, areasTable.name, areasTable.terminal),
    db
      .select()
      .from(issuesTable)
      .where(
        and(gte(issuesTable.issueDate, from), lt(issuesTable.issueDate, to)),
      ),
    db
      .select({ entry: timeEntriesTable, staffName: staffTable.name })
      .from(timeEntriesTable)
      .innerJoin(staffTable, eq(timeEntriesTable.staffId, staffTable.id))
      .where(
        and(
          gte(timeEntriesTable.workDate, from),
          lt(timeEntriesTable.workDate, to),
        ),
      ),
    db
      .select()
      .from(incidentsTable)
      .where(
        and(
          sql`(${incidentsTable.occurredAt} AT TIME ZONE 'America/New_York')::date >= ${from}::date`,
          sql`(${incidentsTable.occurredAt} AT TIME ZONE 'America/New_York')::date < ${to}::date`,
        ),
      ),
    db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          gte(inspectionsTable.inspectionDate, from),
          lt(inspectionsTable.inspectionDate, to),
        ),
      ),
  ]);
  const total = tasks.reduce((n, t) => n + t.total, 0);
  const completed = tasks.reduce((n, t) => n + t.completed, 0);
  return {
    month,
    from,
    toExclusive: to,
    company: "Marvol Enterprises",
    site: "MCO parking garages",
    totalTasks: total,
    completedTasks: completed,
    completionPercent: total ? Math.round((completed / total) * 100) : 0,
    photoEvidence: tasks.reduce((n, t) => n + t.photoEvidence, 0),
    areaPerformance: tasks,
    issues: {
      total: issues.length,
      resolved: issues.filter((i) => i.resolved).length,
    },
    incidents: {
      total: incidents.length,
      open: incidents.filter((i) => i.status === "open").length,
      highSeverity: incidents.filter((i) => i.severity === "high").length,
    },
    inspections: {
      total: inspections.length,
      target: 90,
      passed: inspections.filter((i) => i.score >= 90).length,
      averageScore: inspections.length
        ? Math.round(
            inspections.reduce((n, i) => n + i.score, 0) / inspections.length,
          )
        : null,
    },
    timekeeping: {
      approvedHours:
        time
          .filter((t) => t.entry.approvedAt)
          .reduce((n, t) => n + paidMinutes(t.entry), 0) / 60,
      unapprovedEntries: time.filter((t) => !t.entry.approvedAt).length,
      openEntries: time.filter((t) => !t.entry.clockOut).length,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Idempotent across instances; a scheduler can invoke this after sleeping deployments wake. */
export async function generatePreviousMonthlyReport() {
  const month = previousMonth();
  const [existing] = await db
    .select({ month: monthlyReportsTable.month })
    .from(monthlyReportsTable)
    .where(eq(monthlyReportsTable.month, month));
  if (existing) return;
  const report = await buildMonthlyReport(month);
  await db
    .insert(monthlyReportsTable)
    .values({ month, report })
    .onConflictDoNothing();
}
