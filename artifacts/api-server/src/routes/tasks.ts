import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, staffTable, areasTable, issuesTable, notificationsTable, assignmentsTable, inspectorTaskLinksTable, messagesTable, messageEmailOutboxTable, objectUploadsTable } from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { ensureTasksForDate } from "../lib/ensureTasksForDate";
import {
  ListTasksQueryParams,
  CompleteTaskParams,
  CompleteTaskBody,
  UncompleteTaskParams,
  CompleteAllTasksBody,
  GetDashboardQueryParams,
  ListSpecialTasksQueryParams,
  CreateSpecialTaskBody,
} from "@workspace/api-zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { INSPECTOR_EMAIL, normalizedEmail, outboundEmailStatus } from "../lib/sendgridEmailBridge";

const router: IRouter = Router();

router.get("/dashboard", async (req, res) => {
  const query = GetDashboardQueryParams.parse({ date: req.query.date });
  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;

  const areas = await db
    .select()
    .from(areasTable)
    .where(eq(areasTable.archived, false))
    .orderBy(areasTable.sortOrder);

  for (const area of areas) {
    await ensureTasksForDate(area.id, date);
  }

  const activeAreaIds = areas.map((a) => a.id);
  const taskStats = activeAreaIds.length === 0
    ? []
    : await db
        .select({
          areaId: tasksTable.areaId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
        })
        .from(tasksTable)
        .where(and(eq(tasksTable.taskDate, date), inArray(tasksTable.areaId, activeAreaIds)))
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
      percentage: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
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

router.get("/", async (req, res) => {
  const query = ListTasksQueryParams.parse({
    areaId: req.query.areaId,
    date: req.query.date,
    assignedToId: req.query.assignedToId,
  });

  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;
  const areaId = query.areaId;
  const assignedToId = (query as any).assignedToId ? Number((query as any).assignedToId) : undefined;

  const terminalParam = req.query.terminal as string | undefined;

  let activeAreaIdFilter: number[] | null = null;
  if (areaId) {
    await ensureTasksForDate(areaId, date);
  } else if (terminalParam) {
    const terminalAreas = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(and(eq(areasTable.terminal, terminalParam), eq(areasTable.archived, false)));
    for (const area of terminalAreas) {
      await ensureTasksForDate(area.id, date);
    }
    activeAreaIdFilter = terminalAreas.map((a) => a.id);
  } else {
    const allActive = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(eq(areasTable.archived, false));
    activeAreaIdFilter = allActive.map((a) => a.id);
  }

  if (activeAreaIdFilter && activeAreaIdFilter.length === 0) {
    return res.json([]);
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
      completedByActive: staffTable.active,
      assignedToId: tasksTable.assignedToId,
      isSpecial: tasksTable.isSpecial,
      notes: tasksTable.notes,
      beforeImagePath: tasksTable.beforeImagePath,
      afterImagePath: tasksTable.afterImagePath,
    })
    .from(tasksTable)
    .leftJoin(staffTable, eq(tasksTable.completedById, staffTable.id))
    .where(
      and(
        eq(tasksTable.taskDate, date),
        areaId ? eq(tasksTable.areaId, areaId) : undefined,
        activeAreaIdFilter ? inArray(tasksTable.areaId, activeAreaIdFilter) : undefined,
        assignedToId ? eq(tasksTable.assignedToId, assignedToId) : undefined
      )
    )
    .orderBy(tasksTable.areaId, tasksTable.taskOrder);
  const inspectorLinks = tasks.length
    ? await db.select({ taskId: inspectorTaskLinksTable.taskId })
      .from(inspectorTaskLinksTable)
      .where(inArray(inspectorTaskLinksTable.taskId, tasks.map((task) => task.id)))
    : [];
  const inspectorTaskIds = new Set(inspectorLinks.map((link) => link.taskId));

  return res.json(
    tasks.map((t) => {
      let completedByName: string | null = null;
      let completedByActive: boolean | null = null;
      if (t.completedById) {
        completedByName = t.completedByName ?? null;
        completedByActive = t.completedByActive ?? false;
      }
      return {
        ...t,
        completedByName,
        completedByActive,
        completedAt: t.completedAt?.toISOString() ?? null,
        assignedToName: null,
        assignedToActive: null,
        inspectorWorkflowTaskId: inspectorTaskIds.has(t.id) ? t.id : null,
      };
    })
  );
});

router.get("/special", async (req, res) => {
  const query = ListSpecialTasksQueryParams.parse({
    date: req.query.date,
    areaId: req.query.areaId,
  });

  const now = new Date();
  const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = query.date ?? defaultDate;
  const areaId = query.areaId;

  const conditions = [
    eq(tasksTable.isSpecial, true),
    eq(tasksTable.taskDate, date),
  ];
  if (areaId) conditions.push(eq(tasksTable.areaId, areaId));

  const rows = await db
    .select({
      id: tasksTable.id,
      areaId: tasksTable.areaId,
      taskDate: tasksTable.taskDate,
      taskName: tasksTable.taskName,
      taskOrder: tasksTable.taskOrder,
      completed: tasksTable.completed,
      completedAt: tasksTable.completedAt,
      completedById: tasksTable.completedById,
      createdById: tasksTable.createdById,
      notes: tasksTable.notes,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(tasksTable.createdAt);

  const staffIds = [...new Set(rows.flatMap(r => [r.completedById, r.createdById]).filter(Boolean))] as number[];
  const staffInfo: Record<number, { name: string; active: boolean }> = {};
  for (const sid of staffIds) {
    const [s] = await db.select({ name: staffTable.name, active: staffTable.active }).from(staffTable).where(eq(staffTable.id, sid));
    if (s) staffInfo[sid] = { name: s.name, active: s.active };
  }
  const lookupStaff = (id: number | null | undefined): { name: string | null; active: boolean | null } => {
    if (!id) return { name: null, active: null };
    const info = staffInfo[id];
    if (!info) return { name: null, active: false };
    return { name: info.name, active: info.active };
  };

  const areaIds = [...new Set(rows.map(r => r.areaId))];
  const areaNames: Record<number, string> = {};
  for (const aid of areaIds) {
    const [a] = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, aid));
    if (a) areaNames[aid] = a.name;
  }

  res.json(rows.map(r => {
    const completedBy = lookupStaff(r.completedById);
    const createdBy = lookupStaff(r.createdById);
    return {
      ...r,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      completedByName: completedBy.name,
      completedByActive: completedBy.active,
      createdByName: createdBy.name,
      createdByActive: createdBy.active,
      areaName: areaNames[r.areaId] ?? "Unknown Area",
    };
  }));
});

router.post("/special", async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  let body: ReturnType<typeof CreateSpecialTaskBody.parse>;
  try {
    body = CreateSpecialTaskBody.parse(req.body);
  } catch {
    return res.status(400).json({ error: "areaId (number), date (string), and notes (non-empty string) are required" });
  }

  const trimmedNotes = body.notes.trim();
  if (trimmedNotes.length === 0) {
    return res.status(400).json({ error: "areaId (number), date (string), and notes (non-empty string) are required" });
  }

  const [area] = await db.select({ id: areasTable.id, name: areasTable.name }).from(areasTable).where(eq(areasTable.id, body.areaId));
  if (!area) {
    return res.status(400).json({ error: "Invalid areaId" });
  }

  let creator: { name: string; active: boolean } | null = null;
  if (body.createdById != null) {
    const [staff] = await db
      .select({ id: staffTable.id, name: staffTable.name, active: staffTable.active })
      .from(staffTable)
      .where(eq(staffTable.id, body.createdById));
    if (!staff) {
      return res.status(400).json({ error: "Invalid createdById" });
    }
    creator = { name: staff.name, active: staff.active };
  }

  const maxOrder = await db
    .select({ maxO: sql<number>`coalesce(max(${tasksTable.taskOrder}), 0)::int` })
    .from(tasksTable)
    .where(and(eq(tasksTable.areaId, body.areaId), eq(tasksTable.taskDate, body.date)));

  const [created] = await db
    .insert(tasksTable)
    .values({
      areaId: body.areaId,
      taskDate: body.date,
      taskName: trimmedNotes,
      taskOrder: (maxOrder[0]?.maxO ?? 0) + 1,
      completed: false,
      isSpecial: true,
      createdById: body.createdById ?? null,
      notes: trimmedNotes,
    })
    .returning();

  return res.status(201).json({
    id: created.id,
    areaId: created.areaId,
    areaName: area.name,
    taskDate: created.taskDate,
    taskName: created.taskName,
    taskOrder: created.taskOrder,
    completed: created.completed,
    completedAt: null,
    completedById: null,
    completedByName: null,
    completedByActive: null,
    createdById: created.createdById,
    createdByName: creator?.name ?? null,
    createdByActive: creator?.active ?? null,
    createdAt: created.createdAt.toISOString(),
    notes: created.notes,
  });
});

router.post("/complete-all", async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
  if (actor.role !== "admin" && actor.role !== "supervisor") { res.status(403).json({ error: "Supervisor access required" }); return; }
  const body = CompleteAllTasksBody.parse(req.body);
  await ensureTasksForDate(body.areaId, body.date);

  const result = await db
    .update(tasksTable)
    .set({
      completed: true,
      completedAt: new Date(),
      completedById: actor.id,
    })
    .where(
      and(
        eq(tasksTable.areaId, body.areaId),
        eq(tasksTable.taskDate, body.date),
        eq(tasksTable.completed, false),
        sql`NOT EXISTS (SELECT 1 FROM inspector_task_links itl WHERE itl.task_id = ${tasksTable.id})`
      )
    );

  res.json({ updated: (result as any).rowCount ?? 0 });
});

router.post("/:id/complete", async (req, res) => {
  const { id } = CompleteTaskParams.parse({ id: req.params.id });
  const body = CompleteTaskBody.parse(req.body);
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.id !== body.completedById) return res.status(403).json({ error: "You can only complete work as yourself" });
  const completion = await db.transaction(async (tx) => {
    const [lockedTask] = await tx.select().from(tasksTable).where(eq(tasksTable.id, id)).for("update");
    if (!lockedTask) return { status: "not_found" as const };
    const [link] = await tx.select().from(inspectorTaskLinksTable).where(eq(inspectorTaskLinksTable.taskId, id)).for("update");
    // This decision is made only from locked rows, so a concurrent SLA
    // reassignment cannot leave a stale assignee authorized.
    if (link && lockedTask.assignedToId !== actor.id) return { status: "forbidden" as const };
    if (!link && actor.role !== "admin" && actor.role !== "supervisor" && lockedTask.assignedToId !== actor.id) {
      return { status: "forbidden" as const };
    }
    if (lockedTask.completed) return { status: "ok" as const, task: lockedTask, changed: false };
    const [task] = await tx.update(tasksTable).set({ completed: true, completedAt: new Date(), completedById: actor.id })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.completed, false))).returning();
    if (!task) return { status: "conflict" as const };
    if (link && !link.completionMessageId) {
      const [inspector, supervisor, area] = await Promise.all([
        tx.select().from(staffTable).where(eq(staffTable.id, link.inspectorId)).then((r: any[]) => r[0]),
        tx.select().from(staffTable).where(eq(staffTable.id, link.supervisorId)).then((r: any[]) => r[0]),
        tx.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, task.areaId)).then((r: any[]) => r[0]),
      ]);
      if (inspector && supervisor && normalizedEmail(inspector.email) === INSPECTOR_EMAIL) {
        const completionBody = `COMPLETED — Inspector special assignment\nArea: ${area?.name ?? "Assigned area"}\nCompleted by: ${actor.name}`;
        const [message] = await tx.insert(messagesTable).values({ conversationId: link.conversationId, senderId: supervisor.id, body: completionBody }).returning();
        await tx.insert(messageEmailOutboxTable).values({ messageId: message.id, conversationId: link.conversationId, inspectorId: inspector.id, supervisorId: supervisor.id, inspectorEmail: inspector.email!, inspectorName: inspector.name, supervisorName: supervisor.name, messageBody: completionBody, status: outboundEmailStatus() });
        await tx.update(inspectorTaskLinksTable).set({ completionMessageId: message.id }).where(and(eq(inspectorTaskLinksTable.taskId, task.id), sql`${inspectorTaskLinksTable.completionMessageId} IS NULL`));
      }
    }
    return { status: "ok" as const, task, changed: true };
  });
  if (completion.status === "not_found") return res.status(404).json({ error: "Task not found" });
  if (completion.status === "forbidden") return res.status(403).json({ error: "Inspector workflow completion requires the locked current assignee" });
  if (completion.status === "conflict") return res.status(409).json({ error: "Task completion changed concurrently" });
  const updated = completion.task;

  const staffMember = updated.completedById
    ? await db
        .select({ name: staffTable.name, active: staffTable.active })
        .from(staffTable)
        .where(eq(staffTable.id, updated.completedById))
        .then((r) => r[0])
    : null;
  const completedByName = staffMember?.name ?? null;
  const completedByActive: boolean | null = updated.completedById
    ? (staffMember?.active ?? false)
    : null;

  const area = await db.select({ name: areasTable.name }).from(areasTable).where(eq(areasTable.id, updated.areaId)).then((r) => r[0]);
  const recipients = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(and(inArray(staffTable.role, ["inspector", "supervisor", "admin"]), eq(staffTable.active, true)));
  if (completion.changed && recipients.length > 0 && area) {
    const completedBy = completedByName ?? "Staff";
    await db.insert(notificationsTable).values(
      recipients.map((r) => ({
        staffId: r.id,
        type: "task_completed" as const,
        message: `${completedBy} completed "${updated.taskName}" in ${area.name}`,
      }))
    );
  }

  return res.json({
    ...updated,
    taskDate: updated.taskDate,
    completedAt: updated.completedAt?.toISOString() ?? null,
    completedByName,
    completedByActive,
    assignedToName: null,
    assignedToActive: null,
  });
});

router.post("/:id/uncomplete", async (req, res) => {
  const { id } = UncompleteTaskParams.parse({ id: req.params.id });
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  const uncompletion = await db.transaction(async (tx) => {
    const [lockedTask] = await tx.select().from(tasksTable).where(eq(tasksTable.id, id)).for("update");
    if (!lockedTask) return { status: "not_found" as const };
    const [link] = await tx.select().from(inspectorTaskLinksTable).where(eq(inspectorTaskLinksTable.taskId, id)).for("update");
    if (link && lockedTask.assignedToId !== actor.id) return { status: "forbidden" as const };
    if (!link && actor.role !== "admin" && actor.role !== "supervisor" && lockedTask.assignedToId !== actor.id) return { status: "forbidden" as const };
    if (!lockedTask.completed) return { status: "ok" as const, task: lockedTask };
    const [task] = await tx.update(tasksTable).set({
      completed: false,
      completedAt: null,
      completedById: null,
    }).where(and(eq(tasksTable.id, id), eq(tasksTable.completed, true))).returning();
    return task ? { status: "ok" as const, task } : { status: "conflict" as const };
  });
  if (uncompletion.status === "not_found") return res.status(404).json({ error: "Task not found" });
  if (uncompletion.status === "forbidden") return res.status(403).json({ error: "Inspector workflow uncomplete requires the locked current assignee" });
  if (uncompletion.status === "conflict") return res.status(409).json({ error: "Task changed concurrently" });
  const updated = uncompletion.task;

  return res.json({
    ...updated,
    taskDate: updated.taskDate,
    completedAt: null,
    completedByName: null,
    completedByActive: null,
    assignedToName: null,
    assignedToActive: null,
  });
});

router.patch("/:id/images", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task id" });
  }
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  const [authorizationTask] = await db.select({ assignedToId: tasksTable.assignedToId }).from(tasksTable).where(eq(tasksTable.id, id));
  if (!authorizationTask) return res.status(404).json({ error: "Task not found" });
  if (actor.role !== "admin" && actor.role !== "supervisor" && authorizationTask.assignedToId !== actor.id) return res.status(403).json({ error: "Only the assignee or management may attach task images" });

  const { beforeImagePath, afterImagePath } = req.body;
  for (const [path, purpose] of [[beforeImagePath, "task_before"], [afterImagePath, "task_after"]] as const) {
    if (path === undefined || path === null) continue;
    if (typeof path !== "string" || !path.startsWith("/objects/")) return res.status(400).json({ error: "Invalid private object path" });
    const [upload] = await db.select().from(objectUploadsTable).where(and(eq(objectUploadsTable.objectPath, path), eq(objectUploadsTable.taskId, id)));
    if (!upload || upload.purpose !== purpose || (actor.role === "staff" && upload.ownerStaffId !== actor.id)) return res.status(403).json({ error: "Object is not authorized for this task image" });
  }
  const updates: Record<string, string | null> = {};
  if (beforeImagePath !== undefined) updates.beforeImagePath = beforeImagePath;
  if (afterImagePath !== undefined) updates.afterImagePath = afterImagePath;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No image fields provided" });
  }

  const [updated] = await db
    .update(tasksTable)
    .set(updates)
    .where(eq(tasksTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.json({
    ...updated,
    completedAt: updated.completedAt?.toISOString() ?? null,
  });
});

export default router;
