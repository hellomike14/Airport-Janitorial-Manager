import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tasksTable, staffTable, areasTable, issuesTable, notificationsTable, assignmentsTable } from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { ensureTasksForDate } from "../lib/ensureTasksForDate";
import {
  ListTasksQueryParams,
  CompleteTaskParams,
  CompleteTaskBody,
  UncompleteTaskParams,
  CompleteAllTasksBody,
  GetDashboardQueryParams,
} from "@workspace/api-zod";

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

  if (areaId) {
    await ensureTasksForDate(areaId, date);
  } else if (terminalParam) {
    const terminalAreas = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(eq(areasTable.terminal, terminalParam));
    for (const area of terminalAreas) {
      await ensureTasksForDate(area.id, date);
    }
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
        assignedToId ? eq(tasksTable.assignedToId, assignedToId) : undefined
      )
    )
    .orderBy(tasksTable.areaId, tasksTable.taskOrder);

  res.json(
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
      };
    })
  );
});

router.get("/special", async (req, res) => {
  const now = new Date();
  const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = (req.query.date as string) ?? defaultDate;
  const areaId = req.query.areaId ? parseInt(req.query.areaId as string) : undefined;

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
      createdAt: r.createdAt?.toISOString() ?? null,
      completedByName: completedBy.name,
      completedByActive: completedBy.active,
      createdByName: createdBy.name,
      createdByActive: createdBy.active,
      areaName: areaNames[r.areaId] ?? "Unknown Area",
    };
  }));
});

router.post("/special", async (req, res) => {
  const { areaId, date, notes, createdById } = req.body;
  if (!areaId || !date || !notes || typeof areaId !== "number" || typeof notes !== "string" || notes.trim().length === 0) {
    return res.status(400).json({ error: "areaId (number), date (string), and notes (non-empty string) are required" });
  }

  const [area] = await db.select({ id: areasTable.id }).from(areasTable).where(eq(areasTable.id, areaId));
  if (!area) {
    return res.status(400).json({ error: "Invalid areaId" });
  }

  if (createdById) {
    const [staff] = await db.select({ id: staffTable.id }).from(staffTable).where(eq(staffTable.id, createdById));
    if (!staff) {
      return res.status(400).json({ error: "Invalid createdById" });
    }
  }

  const maxOrder = await db
    .select({ maxO: sql<number>`coalesce(max(${tasksTable.taskOrder}), 0)::int` })
    .from(tasksTable)
    .where(and(eq(tasksTable.areaId, areaId), eq(tasksTable.taskDate, date)));

  const [created] = await db
    .insert(tasksTable)
    .values({
      areaId,
      taskDate: date,
      taskName: notes.trim(),
      taskOrder: (maxOrder[0]?.maxO ?? 0) + 1,
      completed: false,
      isSpecial: true,
      createdById: createdById ?? null,
      notes: notes.trim(),
    })
    .returning();

  res.status(201).json({
    ...created,
    completedAt: null,
    completedByName: null,
    completedByActive: null,
    assignedToName: null,
    assignedToActive: null,
  });
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
  if (recipients.length > 0 && area) {
    const completedBy = completedByName ?? "Staff";
    await db.insert(notificationsTable).values(
      recipients.map((r) => ({
        staffId: r.id,
        type: "task_completed" as const,
        message: `${completedBy} completed "${updated.taskName}" in ${area.name}`,
      }))
    );
  }

  res.json({
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

  const { beforeImagePath, afterImagePath } = req.body;
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

  res.json({
    ...updated,
    completedAt: updated.completedAt?.toISOString() ?? null,
  });
});

export default router;
