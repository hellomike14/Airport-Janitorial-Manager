import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  staffTable,
  areasTable,
  issuesTable,
  notificationsTable,
  assignmentsTable,
  inspectorTaskLinksTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray, or, isNull } from "drizzle-orm";
import { ensureTasksForDate } from "../lib/ensureTasksForDate";
import { actorStaffFromRequest, type StaffRow } from "../lib/actorSession";
import { sendInspectorRequestEmail } from "../lib/inspectorRequestEmail";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { z } from "zod";
import { canStaffWorkTaskByScope } from "../lib/operationsPolicy";
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
import {
  queueInspectorTaskCompletionEmail,
  sweepOverdueInspectorAssignments,
} from "../lib/inspectorTaskWorkflow";
import { verifyInboundWebhookSecret } from "../lib/sendgridEmailBridge";

const router: IRouter = Router();

function isManager(actor: StaffRow): boolean {
  return actor.role === "admin" || actor.role === "supervisor";
}

async function assignedAreaIdsForDate(
  staffId: number,
  date: string,
): Promise<number[]> {
  const rows = await db
    .select({ areaId: assignmentsTable.areaId })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.staffId, staffId),
        eq(assignmentsTable.assignmentDate, date),
      ),
    );
  return [...new Set(rows.map((row) => row.areaId))];
}

async function staffCanWorkTask(
  actor: StaffRow,
  task: { areaId: number; taskDate: string; assignedToId: number | null },
): Promise<boolean> {
  if (isManager(actor)) return true;
  if (actor.role !== "staff") return false;
  if (task.assignedToId !== null) {
    return canStaffWorkTaskByScope(actor.id, task.assignedToId, false);
  }

  const [assignment] = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.staffId, actor.id),
        eq(assignmentsTable.areaId, task.areaId),
        eq(assignmentsTable.assignmentDate, task.taskDate),
      ),
    )
    .limit(1);
  return canStaffWorkTaskByScope(actor.id, null, Boolean(assignment));
}

router.post("/internal/inspector-escalations/sweep", async (req, res) => {
  const expected = process.env.INTERNAL_CRON_SECRET?.trim();
  if (!expected || expected.length < 32) {
    res.status(503).json({ error: "Inspector escalation cron is not configured" });
    return;
  }
  const authorization = req.header("authorization")?.trim();
  const provided = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : req.header("x-internal-cron-secret")?.trim();
  if (verifyInboundWebhookSecret(provided, expected) !== "ok") {
    res.status(401).json({ error: "Invalid cron credential" });
    return;
  }
  const result = await sweepOverdueInspectorAssignments();
  res.json(result);
});

router.get(
  "/dashboard",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
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
    const taskStats =
      activeAreaIds.length === 0
        ? []
        : await db
            .select({
              areaId: tasksTable.areaId,
              total: sql<number>`count(*)::int`,
              completed: sql<number>`sum(case when ${tasksTable.completed} then 1 else 0 end)::int`,
            })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.taskDate, date),
                inArray(tasksTable.areaId, activeAreaIds),
              ),
            )
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
        and(
          eq(assignmentsTable.staffId, staffTable.id),
          eq(staffTable.active, true),
        ),
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
          stats.total > 0
            ? Math.round((stats.completed / stats.total) * 100)
            : 0,
        assignedStaff: assignmentsByArea.get(area.id) ?? [],
      };
    });

    const completedAreas = areaProgress.filter(
      (a) => a.percentage === 100,
    ).length;

    res.json({
      date,
      totalTasks,
      completedTasks,
      totalAreas: areas.length,
      completedAreas,
      openIssues: issueCount[0]?.count ?? 0,
      areaProgress,
    });
  },
);

router.get("/", async (req, res) => {
  const actor = res.locals.staffActor as StaffRow;
  const query = ListTasksQueryParams.parse({
    areaId: req.query.areaId,
    date: req.query.date,
    assignedToId: req.query.assignedToId,
  });

  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;
  const areaId = query.areaId;
  const requestedAssignedToId = query.assignedToId;
  const assignedToId =
    actor.role === "staff" && requestedAssignedToId !== undefined
      ? actor.id
      : requestedAssignedToId;
  const staffAreaIds =
    actor.role === "staff" ? await assignedAreaIdsForDate(actor.id, date) : [];

  const terminalParam = req.query.terminal as string | undefined;

  let activeAreaIdFilter: number[] | null = null;
  if (areaId) {
    // Do not let a staff member generate a task sheet for an area outside
    // their shift. Directly assigned special tasks remain readable below.
    if (isManager(actor) || staffAreaIds.includes(areaId)) {
      await ensureTasksForDate(areaId, date);
    }
  } else if (terminalParam) {
    const terminalAreas = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(
        and(
          eq(areasTable.terminal, terminalParam),
          eq(areasTable.archived, false),
        ),
      );
    for (const area of terminalAreas) {
      if (isManager(actor) || staffAreaIds.includes(area.id)) {
        await ensureTasksForDate(area.id, date);
      }
    }
    activeAreaIdFilter = terminalAreas.map((a) => a.id);
  } else if (actor.role === "staff") {
    // Staff receive tasks only for their own assignment areas (plus any task
    // directly assigned to them), including a historically archived area.
    for (const assignedAreaId of staffAreaIds) {
      await ensureTasksForDate(assignedAreaId, date);
    }
  } else {
    const allActive = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(eq(areasTable.archived, false));
    activeAreaIdFilter = allActive.map((a) => a.id);
  }

  if (activeAreaIdFilter && activeAreaIdFilter.length === 0) {
    res.json([]);
    return;
  }

  const staffVisibility =
    actor.role === "staff"
      ? staffAreaIds.length > 0
        ? or(
            eq(tasksTable.assignedToId, actor.id),
            and(
              isNull(tasksTable.assignedToId),
              inArray(tasksTable.areaId, staffAreaIds),
            ),
          )
        : eq(tasksTable.assignedToId, actor.id)
      : undefined;
  const inspectorVisibility =
    actor.role === "inspector" ? eq(tasksTable.completed, true) : undefined;

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
        activeAreaIdFilter
          ? inArray(tasksTable.areaId, activeAreaIdFilter)
          : undefined,
        assignedToId !== undefined
          ? eq(tasksTable.assignedToId, assignedToId)
          : undefined,
        staffVisibility,
        inspectorVisibility,
      ),
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
    }),
  );
});

router.get("/special", async (req, res) => {
  const actor = res.locals.staffActor as StaffRow;
  // Viewing the urgent queue also performs a durable overdue sweep. This is
  // a secondary safety net; production should still call the protected cron
  // endpoint every minute so enforcement does not depend on an open browser.
  try {
    await sweepOverdueInspectorAssignments();
  } catch (error) {
    console.error("Inspector escalation sweep failed during task listing:", error);
  }
  const query = ListSpecialTasksQueryParams.parse({
    date: req.query.date,
    areaId: req.query.areaId,
  });

  const now = new Date();
  const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = query.date ?? defaultDate;
  const areaId = query.areaId;
  const staffAreaIds =
    actor.role === "staff" ? await assignedAreaIdsForDate(actor.id, date) : [];

  const conditions = [
    eq(tasksTable.isSpecial, true),
    eq(tasksTable.taskDate, date),
  ];
  if (areaId) conditions.push(eq(tasksTable.areaId, areaId));
  if (actor.role === "staff") {
    conditions.push(
      staffAreaIds.length > 0
        ? or(
            eq(tasksTable.assignedToId, actor.id),
            and(
              isNull(tasksTable.assignedToId),
              inArray(tasksTable.areaId, staffAreaIds),
            ),
          )!
        : eq(tasksTable.assignedToId, actor.id),
    );
  }

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
      assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById,
      notes: tasksTable.notes,
      createdAt: tasksTable.createdAt,
      dueAt: inspectorTaskLinksTable.dueAt,
      escalatedAt: inspectorTaskLinksTable.escalatedAt,
      assignmentMethod: inspectorTaskLinksTable.assignmentMethod,
      sourceMessageId: inspectorTaskLinksTable.sourceMessageId,
    })
    .from(tasksTable)
    .leftJoin(
      inspectorTaskLinksTable,
      eq(inspectorTaskLinksTable.taskId, tasksTable.id),
    )
    .where(and(...conditions))
    .orderBy(tasksTable.createdAt);

  const staffIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.completedById, r.createdById, r.assignedToId])
        .filter(Boolean),
    ),
  ] as number[];
  const staffInfo: Record<number, { name: string; active: boolean }> = {};
  for (const sid of staffIds) {
    const [s] = await db
      .select({ name: staffTable.name, active: staffTable.active })
      .from(staffTable)
      .where(eq(staffTable.id, sid));
    if (s) staffInfo[sid] = { name: s.name, active: s.active };
  }
  const lookupStaff = (
    id: number | null | undefined,
  ): { name: string | null; active: boolean | null } => {
    if (!id) return { name: null, active: null };
    const info = staffInfo[id];
    if (!info) return { name: null, active: false };
    return { name: info.name, active: info.active };
  };

  const areaIds = [...new Set(rows.map((r) => r.areaId))];
  const areaNames: Record<number, string> = {};
  for (const aid of areaIds) {
    const [a] = await db
      .select({ name: areasTable.name })
      .from(areasTable)
      .where(eq(areasTable.id, aid));
    if (a) areaNames[aid] = a.name;
  }

  res.json(
    rows.map((r) => {
      const completedBy = lookupStaff(r.completedById);
      const createdBy = lookupStaff(r.createdById);
      const assignedTo = lookupStaff(r.assignedToId);
      return {
        ...r,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        dueAt: r.dueAt?.toISOString() ?? null,
        escalatedAt: r.escalatedAt?.toISOString() ?? null,
        completedByName: completedBy.name,
        completedByActive: completedBy.active,
        createdByName: createdBy.name,
        createdByActive: createdBy.active,
        assignedToName: assignedTo.name,
        assignedToActive: assignedTo.active,
        areaName: areaNames[r.areaId] ?? "Unknown Area",
      };
    }),
  );
});

router.post(
  "/special",
  requireStaffRole("admin", "supervisor", "inspector"),
  async (req, res) => {
    let body: ReturnType<typeof CreateSpecialTaskBody.parse>;
    try {
      body = CreateSpecialTaskBody.parse(req.body);
    } catch {
      res
        .status(400)
        .json({
          error:
            "areaId (number), date (string), and notes (non-empty string) are required",
        });
      return;
    }

    const trimmedNotes = body.notes.trim();
    if (trimmedNotes.length === 0) {
      res
        .status(400)
        .json({
          error:
            "areaId (number), date (string), and notes (non-empty string) are required",
        });
      return;
    }

    const [area] = await db
      .select({ id: areasTable.id, name: areasTable.name })
      .from(areasTable)
      .where(
        and(
          eq(areasTable.id, body.areaId),
          eq(areasTable.archived, false),
        ),
      );
    if (!area) {
      res.status(400).json({ error: "Invalid areaId" });
      return;
    }

    const creator =
      (res.locals.staffActor as StaffRow | undefined) ??
      (await actorStaffFromRequest(req));
    if (!creator) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    if (!["admin", "supervisor", "inspector"].includes(creator.role)) {
      res
        .status(403)
        .json({
          error: "Only inspectors and managers can create special requests",
        });
      return;
    }

    const maxOrder = await db
      .select({
        maxO: sql<number>`coalesce(max(${tasksTable.taskOrder}), 0)::int`,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.areaId, body.areaId),
          eq(tasksTable.taskDate, body.date),
        ),
      );

    const [created] = await db
      .insert(tasksTable)
      .values({
        areaId: body.areaId,
        taskDate: body.date,
        taskName: trimmedNotes,
        taskOrder: (maxOrder[0]?.maxO ?? 0) + 1,
        completed: false,
        isSpecial: true,
        createdById: creator.id,
        notes: trimmedNotes,
      })
      .returning();

    let emailNotificationStatus:
      | "not_applicable"
      | "sent"
      | "disabled"
      | "not_configured"
      | "failed" = "not_applicable";
    if (creator.role === "inspector") {
      const emailResult = await sendInspectorRequestEmail({
        requesterName: creator.name,
        areaName: area.name,
        requestedDate: body.date,
        details: trimmedNotes,
      });
      emailNotificationStatus = emailResult.status;
      if (emailResult.status !== "sent") {
        const log =
          emailResult.status === "failed" ? console.error : console.warn;
        log("[inspector-request-email] notification was not sent", {
          taskId: created.id,
          status: emailResult.status,
          error: emailResult.error,
        });
      }
    }

    res.status(201).json({
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
      createdByName: creator.name,
      createdByActive: creator.active,
      createdAt: created.createdAt.toISOString(),
      notes: created.notes,
      emailNotificationStatus,
    });
  },
);

router.post(
  "/complete-all",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
    const body = CompleteAllTasksBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const actor = res.locals.staffActor as StaffRow;
    const [area] = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(
        and(
          eq(areasTable.id, body.data.areaId),
          eq(areasTable.archived, false),
        ),
      );
    if (!area) {
      res.status(400).json({ error: "Invalid or archived areaId" });
      return;
    }

    await ensureTasksForDate(body.data.areaId, body.data.date);

    const result = await db
      .update(tasksTable)
      .set({
        completed: true,
        completedAt: new Date(),
        // Keep accepting completedById for API compatibility, but the verified
        // session is the sole source of the completion audit identity.
        completedById: actor.id,
      })
      .where(
        and(
          eq(tasksTable.areaId, body.data.areaId),
          eq(tasksTable.taskDate, body.data.date),
          eq(tasksTable.completed, false),
          eq(tasksTable.isSpecial, false),
        ),
      );

    res.json({ updated: (result as any).rowCount ?? 0 });
  },
);

router.post(
  "/:id/complete",
  requireStaffRole("admin", "supervisor", "staff"),
  async (req, res) => {
    const { id } = CompleteTaskParams.parse({ id: req.params.id });
    const body = CompleteTaskBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const actor = res.locals.staffActor as StaffRow;

    const [existingTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));

    if (!existingTask) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!(await staffCanWorkTask(actor, existingTask))) {
      res
        .status(403)
        .json({ error: "Task is not assigned to this staff account" });
      return;
    }
    if (
      actor.role === "staff" &&
      existingTask.completed &&
      existingTask.completedById !== actor.id
    ) {
      res
        .status(403)
        .json({ error: "Task was completed by another staff account" });
      return;
    }

    let updated = existingTask;
    let newlyCompleted = false;
    if (!existingTask.completed) {
      const [completion] = await db
        .update(tasksTable)
        .set({
          completed: true,
          completedAt: new Date(),
          completedById: actor.id,
        })
        .where(and(eq(tasksTable.id, id), eq(tasksTable.completed, false)))
        .returning();
      if (completion) {
        updated = completion;
        newlyCompleted = true;
      } else {
        // A second tap can lose the conditional update after the first request
        // completes it. Re-read so the retry is idempotent instead of returning
        // a misleading 404 or creating duplicate completion notifications.
        const [current] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, id));
        if (!current) {
          res.status(404).json({ error: "Task not found" });
          return;
        }
        if (
          actor.role === "staff" &&
          current.completedById !== actor.id
        ) {
          res
            .status(403)
            .json({ error: "Task was completed by another staff account" });
          return;
        }
        updated = current;
      }
    }

    const completedByStaff = updated.completedById
      ? await db
          .select({ name: staffTable.name, active: staffTable.active })
          .from(staffTable)
          .where(eq(staffTable.id, updated.completedById))
          .then((rows) => rows[0])
      : undefined;
    // A manager may retry a completed request solely to recover a failed
    // completion-email enqueue. Always credit the immutable task completer,
    // never whichever actor performed the retry.
    const completedByName = completedByStaff?.name ?? "Staff";
    const completedByActive: boolean | null = updated.completedById
      ? (completedByStaff?.active ?? false)
      : null;

    const area = await db
      .select({ name: areasTable.name })
      .from(areasTable)
      .where(eq(areasTable.id, updated.areaId))
      .then((r) => r[0]);
    const recipients = !newlyCompleted
      ? []
      : await db
          .select({ id: staffTable.id })
          .from(staffTable)
          .where(
            and(
              inArray(staffTable.role, ["inspector", "supervisor", "admin"]),
              eq(staffTable.active, true),
              eq(staffTable.loginEnabled, true),
            ),
          );
    if (newlyCompleted && recipients.length > 0 && area) {
      const completedBy = completedByName ?? "Staff";
      await db.insert(notificationsTable).values(
        recipients.map((r) => ({
          staffId: r.id,
          type: "task_completed" as const,
          message: `${completedBy} completed "${updated.taskName}" in ${area.name}`,
        })),
      );
    }

    let completionEmailStatus:
      | Awaited<ReturnType<typeof queueInspectorTaskCompletionEmail>>["status"]
      | undefined;
    try {
      const completionEmail = await queueInspectorTaskCompletionEmail({
        taskId: updated.id,
        completedByName,
        completedAt: updated.completedAt ?? new Date(),
      });
      completionEmailStatus = completionEmail.status;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "inspector_task_completion_email_queue",
          status: "failed",
          taskId: updated.id,
          error:
            error instanceof Error ? error.message : "Unknown completion email error",
        }),
      );
      res.status(503).json({
        error:
          "Task was completed, but the inspector notification could not be queued. Retry this completion to send it.",
        taskCompleted: true,
      });
      return;
    }

    res.json({
      ...updated,
      taskDate: updated.taskDate,
      completedAt: updated.completedAt?.toISOString() ?? null,
      completedByName,
      completedByActive,
      assignedToName: null,
      assignedToActive: null,
      completionEmailStatus,
    });
  },
);

router.post(
  "/:id/uncomplete",
  requireStaffRole("admin", "supervisor", "staff"),
  async (req, res) => {
    const { id } = UncompleteTaskParams.parse({ id: req.params.id });
    const actor = res.locals.staffActor as StaffRow;

    const [existingTask] = await db
      .select({
        id: tasksTable.id,
        areaId: tasksTable.areaId,
        taskDate: tasksTable.taskDate,
        assignedToId: tasksTable.assignedToId,
        completed: tasksTable.completed,
        completedById: tasksTable.completedById,
      })
      .from(tasksTable)
      .where(eq(tasksTable.id, id));

    if (!existingTask) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!(await staffCanWorkTask(actor, existingTask))) {
      res
        .status(403)
        .json({ error: "Task is not assigned to this staff account" });
      return;
    }
    if (actor.role === "staff" && existingTask.completedById !== actor.id) {
      res
        .status(403)
        .json({ error: "Staff may only undo their own completion" });
      return;
    }

    const [inspectorLink] = await db
      .select({ taskId: inspectorTaskLinksTable.taskId })
      .from(inspectorTaskLinksTable)
      .where(eq(inspectorTaskLinksTable.taskId, id));
    if (inspectorLink) {
      res.status(409).json({
        error:
          "Inspector-email tasks cannot be reopened after completion. Create a new request if more work is needed.",
      });
      return;
    }

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
  },
);

const TaskImagesBody = z.object({
  beforeImagePath: z.string().nullable().optional(),
  afterImagePath: z.string().nullable().optional(),
});

router.patch(
  "/:id/images",
  requireStaffRole("admin", "supervisor", "staff"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const body = TaskImagesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid image fields" });
      return;
    }

    const actor = res.locals.staffActor as StaffRow;
    const [existingTask] = await db
      .select({
        id: tasksTable.id,
        areaId: tasksTable.areaId,
        taskDate: tasksTable.taskDate,
        assignedToId: tasksTable.assignedToId,
        completed: tasksTable.completed,
        completedById: tasksTable.completedById,
      })
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existingTask) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!(await staffCanWorkTask(actor, existingTask))) {
      res
        .status(403)
        .json({ error: "Task is not assigned to this staff account" });
      return;
    }
    if (
      actor.role === "staff" &&
      existingTask.completed &&
      existingTask.completedById !== actor.id
    ) {
      res
        .status(403)
        .json({ error: "Task evidence belongs to another staff account" });
      return;
    }

    const { beforeImagePath, afterImagePath } = body.data;
    const updates: Record<string, string | null> = {};
    if (beforeImagePath !== undefined)
      updates.beforeImagePath = beforeImagePath;
    if (afterImagePath !== undefined) updates.afterImagePath = afterImagePath;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No image fields provided" });
      return;
    }

    const [updated] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json({
      ...updated,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
  },
);

export default router;
