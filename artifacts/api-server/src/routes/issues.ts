import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { issuesTable, staffTable, areasTable, notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  ListIssuesQueryParams,
  CreateIssueBody,
  ResolveIssueParams,
  UpdateIssueImagesParams,
  UpdateIssueImagesBody,
} from "@workspace/api-zod";
import { z } from "zod";

const router: IRouter = Router();

const AssignIssueParams = z.object({ id: z.coerce.number() });
const AssignIssueBody = z.object({
  assignedToId: z.number().nullable().optional(),
  assignedById: z.number(),
});
const CompleteIssueParams = z.object({ id: z.coerce.number() });
const CompleteIssueBody = z.object({
  completionNotes: z.string().nullable().optional(),
  completedById: z.number(),
});
const ListIssuesWithAssignedQuery = z.object({
  date: z.string().optional(),
  areaId: z.coerce.number().optional(),
  assignedToId: z.coerce.number().optional(),
});

async function fetchFullIssue(id: number) {
  const assigned = db.select({ name: staffTable.name }).from(staffTable);

  const rows = await db
    .select({
      id: issuesTable.id,
      areaId: issuesTable.areaId,
      areaName: areasTable.name,
      reportedById: issuesTable.reportedById,
      reportedByName: staffTable.name,
      assignedToId: issuesTable.assignedToId,
      issueDate: issuesTable.issueDate,
      description: issuesTable.description,
      severity: issuesTable.severity,
      resolved: issuesTable.resolved,
      resolvedAt: issuesTable.resolvedAt,
      completionNotes: issuesTable.completionNotes,
      beforeImagePath: issuesTable.beforeImagePath,
      afterImagePath: issuesTable.afterImagePath,
      createdAt: issuesTable.createdAt,
    })
    .from(issuesTable)
    .innerJoin(areasTable, eq(issuesTable.areaId, areasTable.id))
    .innerJoin(staffTable, eq(issuesTable.reportedById, staffTable.id))
    .where(eq(issuesTable.id, id));

  if (!rows[0]) return null;
  const row = rows[0];

  let assignedToName: string | null = null;
  if (row.assignedToId) {
    const [s] = await db
      .select({ name: staffTable.name })
      .from(staffTable)
      .where(eq(staffTable.id, row.assignedToId));
    assignedToName = s?.name ?? null;
  }

  return formatIssueRow({ ...row, assignedToName });
}

function formatIssueRow(i: any) {
  return {
    id: i.id,
    areaId: i.areaId,
    areaName: i.areaName,
    reportedById: i.reportedById,
    reportedByName: i.reportedByName,
    assignedToId: i.assignedToId ?? null,
    assignedToName: i.assignedToName ?? null,
    issueDate: i.issueDate,
    description: i.description,
    severity: i.severity,
    resolved: i.resolved,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    completionNotes: i.completionNotes ?? null,
    beforeImagePath: i.beforeImagePath ?? null,
    afterImagePath: i.afterImagePath ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

async function notifySupervisors(message: string, issueId: number, excludeId?: number) {
  const supervisors = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.role, "supervisor"));

  const admins = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.role, "admin"));

  const recipients = [...supervisors, ...admins]
    .filter((s) => s.id !== excludeId)
    .map((s) => s.id);

  if (recipients.length === 0) return;

  await db.insert(notificationsTable).values(
    recipients.map((staffId) => ({
      staffId,
      issueId,
      type: "new_issue" as const,
      message,
    }))
  );
}

router.get("/", async (req: Request, res: Response) => {
  const query = ListIssuesWithAssignedQuery.parse({
    date: req.query.date,
    areaId: req.query.areaId,
    assignedToId: req.query.assignedToId,
  });

  const rows = await db
    .select({
      id: issuesTable.id,
      areaId: issuesTable.areaId,
      areaName: areasTable.name,
      reportedById: issuesTable.reportedById,
      reportedByName: staffTable.name,
      assignedToId: issuesTable.assignedToId,
      issueDate: issuesTable.issueDate,
      description: issuesTable.description,
      severity: issuesTable.severity,
      resolved: issuesTable.resolved,
      resolvedAt: issuesTable.resolvedAt,
      completionNotes: issuesTable.completionNotes,
      beforeImagePath: issuesTable.beforeImagePath,
      afterImagePath: issuesTable.afterImagePath,
      createdAt: issuesTable.createdAt,
    })
    .from(issuesTable)
    .innerJoin(areasTable, eq(issuesTable.areaId, areasTable.id))
    .innerJoin(staffTable, eq(issuesTable.reportedById, staffTable.id))
    .where(
      and(
        query.date ? eq(issuesTable.issueDate, query.date) : undefined,
        query.areaId ? eq(issuesTable.areaId, query.areaId) : undefined,
        query.assignedToId ? eq(issuesTable.assignedToId, query.assignedToId) : undefined
      )
    )
    .orderBy(issuesTable.createdAt);

  const assignedIds = [...new Set(rows.filter((r) => r.assignedToId).map((r) => r.assignedToId as number))];
  const assignedNames: Record<number, string> = {};
  for (const sid of assignedIds) {
    const [s] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, sid));
    if (s) assignedNames[sid] = s.name;
  }

  res.json(rows.map((r) => formatIssueRow({ ...r, assignedToName: r.assignedToId ? (assignedNames[r.assignedToId] ?? null) : null })));
});

router.post("/", async (req: Request, res: Response) => {
  const body = CreateIssueBody.parse(req.body);
  const today = new Date().toISOString().split("T")[0];

  const [created] = await db
    .insert(issuesTable)
    .values({
      areaId: body.areaId,
      reportedById: body.reportedById,
      issueDate: today,
      description: body.description,
      severity: body.severity,
      resolved: false,
      beforeImagePath: (body as any).beforeImagePath ?? null,
    })
    .returning();

  const [area] = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, created.areaId));
  const [reporter] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, created.reportedById));

  const areaName = area?.name ?? "Unknown area";
  const reporterName = reporter?.name ?? "Unknown";
  const severityLabel = body.severity.charAt(0).toUpperCase() + body.severity.slice(1);

  await notifySupervisors(
    `[${severityLabel}] Issue reported in ${areaName} by ${reporterName}: "${body.description.slice(0, 80)}${body.description.length > 80 ? "…" : ""}"`,
    created.id,
    body.reportedById
  );

  res.status(201).json(formatIssueRow({
    ...created,
    areaName,
    reportedByName: reporterName,
    assignedToId: null,
    assignedToName: null,
  }));
});

router.patch("/:id/assign", async (req: Request, res: Response) => {
  const params = AssignIssueParams.safeParse({ id: req.params.id });
  const body = AssignIssueBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(issuesTable)
    .set({ assignedToId: body.data.assignedToId ?? null })
    .where(eq(issuesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const issue = await fetchFullIssue(params.data.id);

  if (updated.assignedToId) {
    const [assigner] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, body.data.assignedById));
    await db.insert(notificationsTable).values({
      staffId: updated.assignedToId,
      issueId: updated.id,
      type: "issue_assigned",
      message: `${assigner?.name ?? "Supervisor"} assigned you an issue in ${issue?.areaName ?? "an area"}: "${updated.description.slice(0, 60)}${updated.description.length > 60 ? "…" : ""}"`,
    });
  }

  res.json(issue);
});

router.patch("/:id/complete", async (req: Request, res: Response) => {
  const params = CompleteIssueParams.safeParse({ id: req.params.id });
  const body = CompleteIssueBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(issuesTable)
    .set({
      resolved: true,
      resolvedAt: new Date(),
      completionNotes: body.data.completionNotes ?? null,
    })
    .where(eq(issuesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const issue = await fetchFullIssue(params.data.id);
  const [completedBy] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, body.data.completedById));

  await notifySupervisors(
    `Issue in ${issue?.areaName ?? "an area"} marked complete by ${completedBy?.name ?? "Staff"}: "${updated.description.slice(0, 60)}${updated.description.length > 60 ? "…" : ""}"`,
    updated.id
  );

  res.json(issue);
});

router.patch("/:id/images", async (req: Request, res: Response) => {
  const { id } = UpdateIssueImagesParams.parse({ id: req.params.id });
  const body = UpdateIssueImagesBody.parse(req.body);

  const updateValues: Record<string, any> = {};
  if (body.beforeImagePath !== undefined) updateValues.beforeImagePath = body.beforeImagePath;
  if (body.afterImagePath !== undefined) updateValues.afterImagePath = body.afterImagePath;

  const [updated] = await db
    .update(issuesTable)
    .set(updateValues)
    .where(eq(issuesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const issue = await fetchFullIssue(id);
  res.json(issue);
});

router.post("/:id/resolve", async (req: Request, res: Response) => {
  const { id } = ResolveIssueParams.parse({ id: req.params.id });

  const [updated] = await db
    .update(issuesTable)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(issuesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const issue = await fetchFullIssue(id);
  res.json(issue);
});

export default router;
