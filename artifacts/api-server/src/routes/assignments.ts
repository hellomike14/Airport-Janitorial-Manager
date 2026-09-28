import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { assignmentsTable, staffTable, areasTable, schedulesTable } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  ListAssignmentsQueryParams,
  CreateAssignmentBody,
  AssignTerminalGroupBody,
  DeleteAssignmentParams,
} from "@workspace/api-zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { isAssignmentTargetEligible } from "../lib/workflowPolicies";
import { areaBelongsToGroup, planGroupAssignment, TERMINAL_GROUP_KEYS } from "../lib/assignmentGroups";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const query = ListAssignmentsQueryParams.parse({
    date: req.query.date,
    staffId: req.query.staffId,
  });

  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;

  const assignments = await db
    .select({
      id: assignmentsTable.id,
      staffId: assignmentsTable.staffId,
      staffName: staffTable.name,
      areaId: assignmentsTable.areaId,
      areaName: areasTable.name,
      terminal: areasTable.terminal,
      assignmentDate: assignmentsTable.assignmentDate,
      assignedById: assignmentsTable.assignedById,
      notes: assignmentsTable.notes,
      isSpecial: assignmentsTable.isSpecial,
      createdAt: assignmentsTable.createdAt,
    })
    .from(assignmentsTable)
    .innerJoin(
      staffTable,
      and(eq(assignmentsTable.staffId, staffTable.id), eq(staffTable.active, true))
    )
    .innerJoin(areasTable, eq(assignmentsTable.areaId, areasTable.id))
    .where(
      and(
        eq(assignmentsTable.assignmentDate, date),
        query.staffId ? eq(assignmentsTable.staffId, query.staffId) : undefined
      )
    );

  const supervisorIds = [...new Set(assignments.map((a) => a.assignedById).filter(Boolean))] as number[];
  const supervisors =
    supervisorIds.length > 0
      ? await db
          .select({ id: staffTable.id, name: staffTable.name })
          .from(staffTable)
          .where(inArray(staffTable.id, supervisorIds))
      : [];
  const supMap = new Map(supervisors.map((s) => [s.id, s.name]));

  res.json(
    assignments.map((a) => ({
      ...a,
      assignedByName: supMap.get(a.assignedById) ?? "Unknown",
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  const body = CreateAssignmentBody.parse(req.body);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.assignmentDate)) return res.status(400).json({ error: "Invalid assignment date" });
  const [[target], [targetArea]] = await Promise.all([
    db.select({ id: staffTable.id, active: staffTable.active, formerEmployee: staffTable.formerEmployee })
      .from(staffTable).where(eq(staffTable.id, body.staffId)),
    db.select({ id: areasTable.id }).from(areasTable).where(and(eq(areasTable.id, body.areaId), eq(areasTable.archived, false))),
  ]);
  if (!target || !isAssignmentTargetEligible(target) || !targetArea) return res.status(400).json({ error: "Target staff or area is not eligible" });
  const [created] = await db
    .insert(assignmentsTable)
    .values({
      staffId: body.staffId,
      areaId: body.areaId,
      assignmentDate: body.assignmentDate,
      assignedById: actor.id,
      notes: body.notes ?? null,
      isSpecial: body.isSpecial,
    })
    .returning();

  const assignDate = new Date(body.assignmentDate + "T12:00:00");
  const dayOfWeek = assignDate.getDay();

  const existing = await db
    .select({ id: schedulesTable.id })
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.staffId, body.staffId),
        eq(schedulesTable.dayOfWeek, dayOfWeek),
        eq(schedulesTable.areaId, body.areaId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    const existingShift = await db
      .select({ startTime: schedulesTable.startTime, endTime: schedulesTable.endTime })
      .from(schedulesTable)
      .where(eq(schedulesTable.staffId, body.staffId))
      .limit(1);

    const startTime = existingShift[0]?.startTime ?? "14:00";
    const endTime = existingShift[0]?.endTime ?? "22:00";

    await db.insert(schedulesTable).values({
      staffId: body.staffId,
      areaId: body.areaId,
      dayOfWeek,
      startTime,
      endTime,
      notes: body.notes ?? null,
    });
  }

  const [staff] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, created.staffId));

  const [area] = await db
    .select({ name: areasTable.name })
    .from(areasTable)
    .where(eq(areasTable.id, created.areaId));

  const [supervisor] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, created.assignedById));

  return res.status(201).json({
    ...created,
    staffName: staff?.name ?? "",
    areaName: area?.name ?? "",
    assignedByName: supervisor?.name ?? "",
    createdAt: created.createdAt.toISOString(),
  });
});

router.post("/group", async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  const parsed = AssignTerminalGroupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid group assignment" });
  const body = parsed.data;
  if (!TERMINAL_GROUP_KEYS.includes(body.groupKey as typeof TERMINAL_GROUP_KEYS[number]) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.assignmentDate)) {
    return res.status(400).json({ error: "Invalid group or assignment date" });
  }
  const groupKey = body.groupKey as typeof TERMINAL_GROUP_KEYS[number];
  const result = await db.transaction(async (tx) => {
    // Serialize group saves so two supervisors cannot assign different staff
    // to the same group at the same time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"assignment:" + body.assignmentDate + ":" + groupKey}))`);
    const [target] = await tx.select({
      id: staffTable.id, active: staffTable.active, formerEmployee: staffTable.formerEmployee,
    }).from(staffTable).where(eq(staffTable.id, body.staffId));
    if (!target || !isAssignmentTargetEligible(target)) return { status: "staff" as const };

    const allAreas = await tx.select({
      id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal, location: areasTable.location,
    }).from(areasTable).where(eq(areasTable.archived, false));
    const areaIds = allAreas.filter((area) => areaBelongsToGroup(area, groupKey)).map((area) => area.id);
    if (!areaIds.length) return { status: "empty" as const };

    const existing = await tx.select({
      areaId: assignmentsTable.areaId, staffId: assignmentsTable.staffId,
    }).from(assignmentsTable).innerJoin(staffTable, and(
      eq(assignmentsTable.staffId, staffTable.id),
      eq(staffTable.active, true),
      eq(staffTable.formerEmployee, false),
    )).where(and(
      eq(assignmentsTable.assignmentDate, body.assignmentDate),
      inArray(assignmentsTable.areaId, areaIds),
    ));
    const plan = planGroupAssignment(areaIds, existing, body.staffId);
    if (!plan) return { status: "conflict" as const };
    const { missingIds, existingCount } = plan;
    if (missingIds.length) {
      await tx.insert(assignmentsTable).values(missingIds.map((areaId) => ({
        staffId: body.staffId, areaId, assignmentDate: body.assignmentDate,
        assignedById: actor.id, notes: body.notes ?? null, isSpecial: body.isSpecial,
      })));
    }

    const dayOfWeek = new Date(body.assignmentDate + "T12:00:00").getDay();
    const scheduled = await tx.select({ areaId: schedulesTable.areaId })
      .from(schedulesTable).where(and(
        eq(schedulesTable.staffId, body.staffId),
        eq(schedulesTable.dayOfWeek, dayOfWeek),
        inArray(schedulesTable.areaId, areaIds),
      ));
    const scheduledIds = new Set(scheduled.map((row) => row.areaId));
    const missingSchedules = areaIds.filter((id) => !scheduledIds.has(id));
    if (missingSchedules.length) {
      const [existingShift] = await tx.select({
        startTime: schedulesTable.startTime, endTime: schedulesTable.endTime,
      }).from(schedulesTable).where(eq(schedulesTable.staffId, body.staffId)).limit(1);
      await tx.insert(schedulesTable).values(missingSchedules.map((areaId) => ({
        staffId: body.staffId, areaId, dayOfWeek,
        startTime: existingShift?.startTime ?? "14:00",
        endTime: existingShift?.endTime ?? "22:00",
        notes: body.notes ?? null,
      })));
    }
    return { status: "created" as const, createdCount: missingIds.length, existingCount };
  });
  if (result.status === "staff") return res.status(400).json({ error: "Target staff is not eligible" });
  if (result.status === "empty") return res.status(400).json({ error: "This group has no active cleaning areas" });
  if (result.status === "conflict") return res.status(409).json({ error: "Some areas are already assigned to another staff member for this date" });
  return res.status(201).json({ createdCount: result.createdCount, existingCount: result.existingCount });
});

router.delete("/:id", async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  const { id } = DeleteAssignmentParams.parse({ id: req.params.id });
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, id));
  return res.json({ success: true });
});

export default router;
