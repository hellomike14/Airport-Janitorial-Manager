import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { issuesTable, staffTable, areasTable, notificationsTable, assignmentsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, or } from "drizzle-orm";
import {
  ListIssuesQueryParams,
  CreateIssueBody,
  ResolveIssueParams,
  UpdateIssueImagesParams,
  UpdateIssueImagesBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { actorStaffFromRequest, type StaffRow } from "../lib/actorSession";
import { sendInspectorRequestEmail } from "../lib/inspectorRequestEmail";

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
  from: z.string().optional(),
  to: z.string().optional(),
  areaId: z.coerce.number().optional(),
  assignedToId: z.coerce.number().optional(),
});

type IssueAccessRow = {
  areaId: number;
  assignedToId: number | null;
};

function isManager(actor: StaffRow): boolean {
  return actor.role === "admin" || actor.role === "supervisor";
}

async function requireIssueActor(req: Request, res: Response): Promise<StaffRow | null> {
  const actor =
    (res.locals.staffActor as StaffRow | undefined) ??
    (await actorStaffFromRequest(req));
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return null;
  }
  return actor;
}

function claimedActorMatches(
  res: Response,
  actor: StaffRow,
  claimedId: number | undefined,
  action: string,
): boolean {
  if (claimedId === undefined || claimedId === actor.id) return true;
  res.status(403).json({ error: `Cannot ${action} as another staff member` });
  return false;
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

async function currentAssignedAreaIds(staffId: number): Promise<number[]> {
  const assignments = await db
    .select({ areaId: assignmentsTable.areaId })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.staffId, staffId),
        eq(assignmentsTable.assignmentDate, todayIsoDate()),
      ),
    );
  return [...new Set(assignments.map((assignment) => assignment.areaId))];
}

async function canStaffWorkOnIssue(actor: StaffRow, issue: IssueAccessRow): Promise<boolean> {
  if (issue.assignedToId === actor.id) return true;
  const assignedAreaIds = await currentAssignedAreaIds(actor.id);
  return assignedAreaIds.includes(issue.areaId);
}

async function fetchFullIssue(id: number) {
  const rows = await db
    .select({
      id: issuesTable.id,
      areaId: issuesTable.areaId,
      areaName: areasTable.name,
      reportedById: issuesTable.reportedById,
      reportedByName: staffTable.name,
      reportedByActive: staffTable.active,
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
  let assignedToActive: boolean | null = null;
  if (row.assignedToId) {
    const [s] = await db
      .select({ name: staffTable.name, active: staffTable.active })
      .from(staffTable)
      .where(eq(staffTable.id, row.assignedToId));
    assignedToName = s?.name ?? null;
    assignedToActive = s?.active ?? false;
  }

  return formatIssueRow({
    ...row,
    assignedToName,
    assignedToActive,
  });
}

function formatIssueRow(i: any) {
  return {
    id: i.id,
    areaId: i.areaId,
    areaName: i.areaName,
    reportedById: i.reportedById,
    reportedByName: i.reportedByName,
    reportedByActive: i.reportedByActive ?? false,
    assignedToId: i.assignedToId ?? null,
    assignedToName: i.assignedToName ?? null,
    assignedToActive: i.assignedToId ? (i.assignedToActive ?? false) : null,
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
    .where(and(eq(staffTable.role, "supervisor"), eq(staffTable.active, true)));

  const admins = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(and(eq(staffTable.role, "admin"), eq(staffTable.active, true)));

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
  const actor = await requireIssueActor(req, res);
  if (!actor) return;

  const query = ListIssuesWithAssignedQuery.parse({
    date: req.query.date,
    from: req.query.from,
    to: req.query.to,
    areaId: req.query.areaId,
    assignedToId: req.query.assignedToId,
  });

  const staffAreaIds = actor.role === "staff" ? await currentAssignedAreaIds(actor.id) : [];
  const staffScope =
    actor.role !== "staff"
      ? undefined
      : staffAreaIds.length > 0
        ? or(
            eq(issuesTable.assignedToId, actor.id),
            inArray(issuesTable.areaId, staffAreaIds),
          )
        : eq(issuesTable.assignedToId, actor.id);

  const rows = await db
    .select({
      id: issuesTable.id,
      areaId: issuesTable.areaId,
      areaName: areasTable.name,
      terminal: areasTable.terminal,
      reportedById: issuesTable.reportedById,
      reportedByName: staffTable.name,
      reportedByActive: staffTable.active,
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
        query.from ? gte(issuesTable.issueDate, query.from) : undefined,
        query.to ? lte(issuesTable.issueDate, query.to) : undefined,
        query.areaId ? eq(issuesTable.areaId, query.areaId) : undefined,
        query.assignedToId ? eq(issuesTable.assignedToId, query.assignedToId) : undefined,
        staffScope,
      )
    )
    .orderBy(issuesTable.createdAt);

  const assignedIds = [...new Set(rows.filter((r) => r.assignedToId).map((r) => r.assignedToId as number))];
  const assignedInfo: Record<number, { name: string | null; active: boolean }> = {};
  for (const sid of assignedIds) {
    const [s] = await db
      .select({ name: staffTable.name, active: staffTable.active })
      .from(staffTable)
      .where(eq(staffTable.id, sid));
    assignedInfo[sid] = { name: s?.name ?? null, active: s?.active ?? false };
  }

  res.json(
    rows.map((r) => {
      const assigned = r.assignedToId ? assignedInfo[r.assignedToId] : null;
      return formatIssueRow({
        ...r,
        assignedToName: assigned?.name ?? null,
        assignedToActive: assigned?.active ?? null,
      });
    })
  );
});

router.post("/", async (req: Request, res: Response) => {
  const body = CreateIssueBody.parse(req.body);
  const actor = await requireIssueActor(req, res);
  if (!actor) return;
  if (!claimedActorMatches(res, actor, body.reportedById, "report an issue")) return;

  const today = todayIsoDate();

  const [created] = await db
    .insert(issuesTable)
    .values({
      areaId: body.areaId,
      reportedById: actor.id,
      issueDate: today,
      description: body.description,
      severity: body.severity,
      resolved: false,
      beforeImagePath: (body as any).beforeImagePath ?? null,
    })
    .returning();

  const [area] = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, created.areaId));

  const areaName = area?.name ?? "Unknown area";
  const reporterName = actor.name;
  const reporterActive = actor.active;
  const severityLabel = body.severity.charAt(0).toUpperCase() + body.severity.slice(1);

  await notifySupervisors(
    `[${severityLabel}] Issue reported in ${areaName} by ${reporterName}: "${body.description.slice(0, 80)}${body.description.length > 80 ? "…" : ""}"`,
    created.id,
    actor.id
  );

  res.status(201).json(formatIssueRow({
    ...created,
    areaName,
    reportedByName: reporterName,
    reportedByActive: reporterActive,
    assignedToId: null,
    assignedToName: null,
    assignedToActive: null,
  }));
});

router.patch("/:id/assign", async (req: Request, res: Response) => {
  const params = AssignIssueParams.safeParse({ id: req.params.id });
  const body = AssignIssueBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const actor = await requireIssueActor(req, res);
  if (!actor) return;
  if (!isManager(actor)) {
    res.status(403).json({ error: "Only administrators and supervisors can assign issues" });
    return;
  }
  if (!claimedActorMatches(res, actor, body.data.assignedById, "assign an issue")) return;

  if (body.data.assignedToId != null) {
    const [target] = await db
      .select({ id: staffTable.id, active: staffTable.active })
      .from(staffTable)
      .where(eq(staffTable.id, body.data.assignedToId));
    if (!target || target.active === false) {
      res.status(400).json({ error: "Cannot assign to an inactive staff member" });
      return;
    }
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
    await db.insert(notificationsTable).values({
      staffId: updated.assignedToId,
      issueId: updated.id,
      type: "issue_assigned",
      message: `${actor.name} assigned you an issue in ${issue?.areaName ?? "an area"}: "${updated.description.slice(0, 60)}${updated.description.length > 60 ? "…" : ""}"`,
    });
  }

  res.json(issue);
});

router.patch("/:id/assign-area", async (req: Request, res: Response) => {
  const params = AssignIssueParams.safeParse({ id: req.params.id });
  const body = z.object({ assignedById: z.number() }).safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const actor = await requireIssueActor(req, res);
  if (!actor) return;
  if (!isManager(actor)) {
    res.status(403).json({ error: "Only administrators and supervisors can assign issues" });
    return;
  }
  if (!claimedActorMatches(res, actor, body.data.assignedById, "assign an issue")) return;

  const [issue] = await db.select().from(issuesTable).where(eq(issuesTable.id, params.data.id));
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const today = todayIsoDate();

  const rawAreaAssignments = await db
    .select({ staffId: assignmentsTable.staffId, staffName: staffTable.name })
    .from(assignmentsTable)
    .innerJoin(
      staffTable,
      and(eq(assignmentsTable.staffId, staffTable.id), eq(staffTable.active, true))
    )
    .where(and(eq(assignmentsTable.areaId, issue.areaId), eq(assignmentsTable.assignmentDate, today)));

  const seen = new Set<number>();
  const areaAssignments = rawAreaAssignments.filter((a) => {
    if (seen.has(a.staffId)) return false;
    seen.add(a.staffId);
    return true;
  });

  const [area] = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, issue.areaId));

  await db.update(issuesTable).set({ assignedToId: null }).where(eq(issuesTable.id, params.data.id));

  if (areaAssignments.length > 0) {
    await db.insert(notificationsTable).values(
      areaAssignments.map((a) => ({
        staffId: a.staffId,
        issueId: params.data.id,
        type: "issue_assigned" as const,
        message: `${actor.name} assigned an issue in ${area?.name ?? "your area"} to your team: "${issue.description.slice(0, 60)}${issue.description.length > 60 ? "…" : ""}"`,
      }))
    );
  }

  const fullIssue = await fetchFullIssue(params.data.id);
  res.json({ ...fullIssue, areaStaff: areaAssignments.map((a) => a.staffName) });
});

router.patch("/:id/complete", async (req: Request, res: Response) => {
  const params = CompleteIssueParams.safeParse({ id: req.params.id });
  const body = CompleteIssueBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const actor = await requireIssueActor(req, res);
  if (!actor) return;
  if (actor.role !== "staff" && actor.role !== "admin") {
    res.status(403).json({ error: "Only assigned staff can complete issues" });
    return;
  }
  if (!claimedActorMatches(res, actor, body.data.completedById, "complete an issue")) return;

  const [existingIssue] = await db
    .select({ areaId: issuesTable.areaId, assignedToId: issuesTable.assignedToId })
    .from(issuesTable)
    .where(eq(issuesTable.id, params.data.id));
  if (!existingIssue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (actor.role === "staff" && !(await canStaffWorkOnIssue(actor, existingIssue))) {
    res.status(403).json({ error: "This issue is not assigned to your current area" });
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

  const completionMsg = `Issue in ${issue?.areaName ?? "an area"} marked complete by ${actor.name}: "${updated.description.slice(0, 60)}${updated.description.length > 60 ? "…" : ""}"`;

  const supervisorsAndAdmins = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(and(inArray(staffTable.role, ["supervisor", "admin", "inspector"]), eq(staffTable.active, true)));

  const completionRecipients = supervisorsAndAdmins
    .filter((s) => s.id !== actor.id)
    .map((s) => s.id);

  if (completionRecipients.length > 0) {
    await db.insert(notificationsTable).values(
      completionRecipients.map((staffId) => ({
        staffId,
        issueId: updated.id,
        type: "issue_completed" as const,
        message: completionMsg,
      }))
    );
  }

  res.json(issue);
});

router.patch("/:id/images", async (req: Request, res: Response) => {
  const { id } = UpdateIssueImagesParams.parse({ id: req.params.id });
  const body = UpdateIssueImagesBody.parse(req.body);

  const actor = await requireIssueActor(req, res);
  if (!actor) return;

  const [existingIssue] = await db
    .select({ areaId: issuesTable.areaId, assignedToId: issuesTable.assignedToId })
    .from(issuesTable)
    .where(eq(issuesTable.id, id));
  if (!existingIssue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (actor.role === "staff" && !(await canStaffWorkOnIssue(actor, existingIssue))) {
    res.status(403).json({ error: "This issue is not assigned to your current area" });
    return;
  }

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

  const actor = await requireIssueActor(req, res);
  if (!actor) return;
  if (!isManager(actor)) {
    res.status(403).json({ error: "Only administrators and supervisors can resolve issues" });
    return;
  }

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

const SendToSupervisorBody = z.object({
  issueId: z.number(),
  senderId: z.number().optional(),
  message: z.string().optional(),
});

router.post("/send-to-supervisor", async (req: Request, res: Response) => {
  const body = SendToSupervisorBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const sender = await requireIssueActor(req, res);
  if (!sender) return;
  if (!claimedActorMatches(res, sender, body.data.senderId, "send an inspector request")) return;
  if (sender.role !== "inspector") {
    res.status(403).json({ error: "Only an inspector can send an inspector request" });
    return;
  }

  const issue = await fetchFullIssue(body.data.issueId);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const senderName = sender.name;

  const supervisors = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true));
  const targets = supervisors.filter(s => s.role === "supervisor" || s.role === "admin");

  const photoNote = issue.beforeImagePath ? " (includes before photo)" : "";
  const customMsg = body.data.message ? ` — "${body.data.message}"` : "";
  const msg = `${senderName} flagged issue in ${issue.areaName}: "${issue.description}"${customMsg}${photoNote}`;

  const notifs = targets.map(s => ({
    staffId: s.id,
    issueId: issue.id,
    type: "inspector_to_supervisor" as const,
    message: msg,
  }));

  if (notifs.length > 0) {
    await db.insert(notificationsTable).values(notifs);
  }

  const emailResult = await sendInspectorRequestEmail({
    requesterName: senderName,
    areaName: issue.areaName,
    requestedDate: issue.issueDate,
    details: `${issue.description}${body.data.message ? `\n\nInspector note: ${body.data.message}` : ""}`,
  });
  if (emailResult.status !== "sent") {
    const log = emailResult.status === "failed" ? console.error : console.warn;
    log("[inspector-request-email] issue notification was not sent", {
      issueId: issue.id,
      status: emailResult.status,
      error: emailResult.error,
    });
  }

  res.json({ sent: notifs.length, emailNotificationStatus: emailResult.status });
});

const SendToInspectorBody = z.object({
  issueId: z.number(),
  senderId: z.number().optional(),
  message: z.string().optional(),
});

router.post("/send-to-inspector", async (req: Request, res: Response) => {
  const body = SendToInspectorBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const sender = await requireIssueActor(req, res);
  if (!sender) return;
  if (!claimedActorMatches(res, sender, body.data.senderId, "notify inspectors")) return;
  if (sender.role !== "admin" && sender.role !== "supervisor") {
    res.status(403).json({ error: "Only administrators and supervisors can notify inspectors" });
    return;
  }

  const issue = await fetchFullIssue(body.data.issueId);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const senderName = sender.name;

  const inspectors = await db
    .select()
    .from(staffTable)
    .where(and(eq(staffTable.role, "inspector"), eq(staffTable.active, true)));

  const photoNote = issue.afterImagePath ? " (includes after photo)" : "";
  const customMsg = body.data.message ? ` — "${body.data.message}"` : "";
  const status = issue.resolved ? "Resolved" : "Completed";
  const msg = `${senderName} updated issue in ${issue.areaName}: "${issue.description}" — ${status}${customMsg}${photoNote}`;

  const notifs = inspectors.map(s => ({
    staffId: s.id,
    issueId: issue.id,
    type: "supervisor_to_inspector" as const,
    message: msg,
  }));

  if (notifs.length > 0) {
    await db.insert(notificationsTable).values(notifs);
  }

  res.json({ sent: notifs.length });
});

export default router;
