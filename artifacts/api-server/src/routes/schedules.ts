import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { schedulesTable, staffTable, areasTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MoveTerminalGroupScheduleBody, PreviewTerminalGroupScheduleMoveQueryParams } from "@workspace/api-zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { isAssignmentTargetEligible } from "../lib/workflowPolicies";
import { areaBelongsToGroup, TERMINAL_GROUP_KEYS, type TerminalGroupKey } from "../lib/assignmentGroups";
import { lockScheduleWrites, scheduleGroupLock } from "../lib/scheduleLocks";

// The preview includes every schedule in active group areas, including rows
// already owned by the target. This lets the save detect additions and edits
// between review and confirmation, rather than silently moving a new row.
function scheduleSnapshot(areaIds: number[], rows: Array<{
  id: number; areaId: number | null; staffId: number; dayOfWeek: number;
  startTime: string; endTime: string; notes: string | null; updatedAt: Date;
}>) {
  return createHash("sha256").update(JSON.stringify({
    areaIds: [...areaIds].sort((a, b) => a - b),
    rows: [...rows].sort((a, b) => a.id - b.id).map((row) => [
      row.id, row.areaId, row.staffId, row.dayOfWeek,
      row.startTime, row.endTime, row.notes, row.updatedAt.toISOString(),
    ]),
  })).digest("hex");
}

function targetConflict(rows: Array<{ staffId: number; areaId: number | null; dayOfWeek: number }>, targetId: number) {
  const targetSlots = new Set(rows.filter((row) => row.staffId === targetId)
    .map((row) => `${row.areaId}:${row.dayOfWeek}`));
  for (const row of rows.filter((row) => row.staffId !== targetId)) {
    const slot = `${row.areaId}:${row.dayOfWeek}`;
    if (targetSlots.has(slot)) return true;
    targetSlots.add(slot);
  }
  return false;
}

// Dependencies are injectable so the reviewed move can be exercised against an
// isolated schedule fixture without touching the live schedule tables.
export function createGroupScheduleMoveRouter(
  database: typeof db = db,
  resolveActor: typeof actorStaffFromRequest = actorStaffFromRequest,
): IRouter {
const groupRouter: IRouter = Router();
groupRouter.get("/group/preview", async (req, res) => {
  const actor = await resolveActor(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  const parsed = PreviewTerminalGroupScheduleMoveQueryParams.safeParse(req.query);
  if (!parsed.success || !TERMINAL_GROUP_KEYS.includes(parsed.data.groupKey as TerminalGroupKey)) {
    return res.status(400).json({ error: "Invalid group or target" });
  }
  const { groupKey, staffId } = parsed.data;
  const [target] = await database.select({ id: staffTable.id, active: staffTable.active, formerEmployee: staffTable.formerEmployee })
    .from(staffTable).where(eq(staffTable.id, staffId));
  if (!target || !isAssignmentTargetEligible(target)) return res.status(400).json({ error: "Target staff is not eligible" });
  const areas = await database.select({
    id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal, location: areasTable.location,
  }).from(areasTable).where(eq(areasTable.archived, false));
  const groupAreas = areas.filter((area) => areaBelongsToGroup(area, groupKey as TerminalGroupKey));
  const areaIds = groupAreas.map((area) => area.id);
  const rows = areaIds.length ? await database.select({
    id: schedulesTable.id, staffId: schedulesTable.staffId, staffName: staffTable.name,
    areaId: schedulesTable.areaId, areaName: areasTable.name, dayOfWeek: schedulesTable.dayOfWeek,
    startTime: schedulesTable.startTime, endTime: schedulesTable.endTime,
    notes: schedulesTable.notes, updatedAt: schedulesTable.updatedAt,
  }).from(schedulesTable)
    .innerJoin(staffTable, eq(schedulesTable.staffId, staffTable.id))
    .innerJoin(areasTable, eq(schedulesTable.areaId, areasTable.id))
    .where(inArray(schedulesTable.areaId, areaIds)) : [];
  return res.json({
    snapshot: scheduleSnapshot(areaIds, rows),
    rows: rows.filter((row) => row.staffId !== staffId).map((row) => ({
      id: row.id, staffId: row.staffId, staffName: row.staffName,
      areaId: row.areaId, areaName: row.areaName, dayOfWeek: row.dayOfWeek,
      startTime: row.startTime, endTime: row.endTime,
    })),
    conflict: targetConflict(rows, staffId),
  });
});

groupRouter.post("/group/preview", async (req, res) => {
  const actor = await resolveActor(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (actor.role !== "admin" && actor.role !== "supervisor") return res.status(403).json({ error: "Supervisor access required" });
  const parsed = MoveTerminalGroupScheduleBody.safeParse(req.body);
  if (!parsed.success || !TERMINAL_GROUP_KEYS.includes(parsed.data.groupKey as TerminalGroupKey)) {
    return res.status(400).json({ error: "Invalid schedule move" });
  }
  const { groupKey, staffId, snapshot } = parsed.data;
  const result = await database.transaction(async (tx) => {
    await tx.execute(scheduleGroupLock(groupKey as TerminalGroupKey));
    const [target] = await tx.select({ id: staffTable.id, active: staffTable.active, formerEmployee: staffTable.formerEmployee })
      .from(staffTable).where(eq(staffTable.id, staffId));
    if (!target || !isAssignmentTargetEligible(target)) return { status: "invalid" as const };
    const areas = await tx.select({
      id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal, location: areasTable.location,
    }).from(areasTable).where(eq(areasTable.archived, false));
    const areaIds = areas.filter((area) => areaBelongsToGroup(area, groupKey as TerminalGroupKey)).map((area) => area.id);
    const rows = areaIds.length ? await tx.select({
      id: schedulesTable.id, staffId: schedulesTable.staffId, areaId: schedulesTable.areaId,
      dayOfWeek: schedulesTable.dayOfWeek, startTime: schedulesTable.startTime,
      endTime: schedulesTable.endTime, notes: schedulesTable.notes, updatedAt: schedulesTable.updatedAt,
    }).from(schedulesTable).where(inArray(schedulesTable.areaId, areaIds)).for("update") : [];
    const moving = rows.filter((row) => row.staffId !== staffId);
    if (scheduleSnapshot(areaIds, rows) !== snapshot || !moving.length || targetConflict(rows, staffId)) {
      return { status: "conflict" as const };
    }
    await tx.update(schedulesTable).set({ staffId, updatedAt: new Date() })
      .where(inArray(schedulesTable.id, moving.map((row) => row.id)));
    return { status: "moved" as const, movedCount: moving.length };
  });
  if (result.status === "invalid") return res.status(400).json({ error: "Target staff is not eligible" });
  if (result.status === "conflict") return res.status(409).json({ error: "Schedules changed, no rows need moving, or target already has a schedule for an affected area and weekday. Review again." });
  return res.json({ movedCount: result.movedCount });
});
return groupRouter;
}
export function createSchedulesRouter(
  database: typeof db = db,
  resolveActor: typeof actorStaffFromRequest = actorStaffFromRequest,
): IRouter {
const router: IRouter = Router();
router.use(createGroupScheduleMoveRouter(database, resolveActor));
router.get("/", async (req: Request, res: Response) => {
  const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;

  let schedules;
  if (staffId) {
    schedules = await database
      .select({
        id: schedulesTable.id,
        staffId: schedulesTable.staffId,
        areaId: schedulesTable.areaId,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        notes: schedulesTable.notes,
        staffName: staffTable.name,
        staffRole: staffTable.role,
        areaName: areasTable.name,
        areaTerminal: areasTable.terminal,
      })
      .from(schedulesTable)
      .leftJoin(staffTable, eq(schedulesTable.staffId, staffTable.id))
      .leftJoin(areasTable, eq(schedulesTable.areaId, areasTable.id))
      .where(eq(schedulesTable.staffId, staffId))
      .orderBy(schedulesTable.dayOfWeek, schedulesTable.startTime);
  } else {
    schedules = await database
      .select({
        id: schedulesTable.id,
        staffId: schedulesTable.staffId,
        areaId: schedulesTable.areaId,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        notes: schedulesTable.notes,
        staffName: staffTable.name,
        staffRole: staffTable.role,
        areaName: areasTable.name,
        areaTerminal: areasTable.terminal,
      })
      .from(schedulesTable)
      .leftJoin(staffTable, eq(schedulesTable.staffId, staffTable.id))
      .leftJoin(areasTable, eq(schedulesTable.areaId, areasTable.id))
      .orderBy(schedulesTable.dayOfWeek, schedulesTable.startTime);
  }

  res.json(schedules);
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const ScheduleFields = z.object({
  staffId: z.number().int().positive(),
  areaId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  endTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  notes: z.string().nullable().optional(),
});
const CreateScheduleBody = ScheduleFields.refine((d) => d.startTime < d.endTime, { message: "startTime must be before endTime" });
const UpdateScheduleBody = ScheduleFields.partial().refine(
  (d) => !d.startTime || !d.endTime || d.startTime < d.endTime,
  { message: "startTime must be before endTime" },
);

router.post("/", async (req: Request, res: Response) => {
  const body = CreateScheduleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
    return;
  }

  try {
    const [schedule] = await database.transaction(async (tx) => {
      await lockScheduleWrites(tx);
      return tx.insert(schedulesTable).values({
        staffId: body.data.staffId,
        areaId: body.data.areaId ?? null,
        dayOfWeek: body.data.dayOfWeek,
        startTime: body.data.startTime,
        endTime: body.data.endTime,
        notes: body.data.notes ?? null,
      }).returning();
    });

    res.json(schedule);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create schedule" });
  }
});

const BulkCreateBody = z.object({
  schedules: z.array(CreateScheduleBody),
});

router.post("/bulk", async (req: Request, res: Response) => {
  const body = BulkCreateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  if (body.data.schedules.length === 0) {
    res.json([]);
    return;
  }

  const results = await database.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    return tx.insert(schedulesTable).values(
      body.data.schedules.map((s) => ({
        staffId: s.staffId,
        areaId: s.areaId ?? null,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        notes: s.notes ?? null,
      }))
    ).returning();
  });

  res.json(results);
});

router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateScheduleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [updated] = await database.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    return tx.update(schedulesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(schedulesTable.id, id)).returning();
  });

  if (!updated) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  res.json(updated);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await database.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    return tx.delete(schedulesTable).where(eq(schedulesTable.id, id)).returning();
  });

  if (!deleted) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  res.json({ success: true });
});

router.delete("/staff/:staffId/clear", async (req: Request, res: Response) => {
  const staffId = Number(req.params.staffId);
  if (isNaN(staffId)) {
    res.status(400).json({ error: "Invalid staffId" });
    return;
  }

  const result = await database.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    return tx.delete(schedulesTable).where(eq(schedulesTable.staffId, staffId)).returning();
  });

  res.json({ deleted: result.length });
});
return router;
}

export default createSchedulesRouter();
