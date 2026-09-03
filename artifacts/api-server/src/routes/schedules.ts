import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { schedulesTable, staffTable, areasTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import type { StaffRow } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { validateScheduleTimeUpdate } from "../lib/operationsPolicy";

const router: IRouter = Router();

type ScheduleTarget = { staffId: number; areaId?: number | null };

async function validateScheduleTargets(
  targets: ScheduleTarget[],
): Promise<string | null> {
  const staffIds = [...new Set(targets.map((target) => target.staffId))];
  const eligibleStaff = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(
      and(
        inArray(staffTable.id, staffIds),
        eq(staffTable.role, "staff"),
        eq(staffTable.active, true),
      ),
    );
  if (eligibleStaff.length !== staffIds.length) {
    return "Invalid, inactive, or ineligible staffId";
  }

  const areaIds = [
    ...new Set(
      targets
        .map((target) => target.areaId)
        .filter((areaId): areaId is number => areaId != null),
    ),
  ];
  if (areaIds.length === 0) return null;

  const activeAreas = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(
      and(
        inArray(areasTable.id, areaIds),
        eq(areasTable.archived, false),
      ),
    );
  return activeAreas.length === areaIds.length
    ? null
    : "Invalid or archived areaId";
}

router.get("/", async (req: Request, res: Response) => {
  const actor = res.locals.staffActor as StaffRow;
  const requestedStaffId =
    req.query.staffId === undefined ? undefined : Number(req.query.staffId);
  if (
    requestedStaffId !== undefined &&
    (!Number.isInteger(requestedStaffId) || requestedStaffId <= 0)
  ) {
    res.status(400).json({ error: "Invalid staffId" });
    return;
  }

  const isManager = actor.role === "admin" || actor.role === "supervisor";
  // Non-managers can view their own shift only; a claimed query-string id can
  // never be used to inspect another employee's schedule.
  const staffId = isManager ? requestedStaffId : actor.id;

  let schedules;
  if (staffId) {
    schedules = await db
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
    schedules = await db
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

const ScheduleBodyFields = z.object({
  staffId: z.number().int().positive(),
  areaId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  endTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  notes: z.string().nullable().optional(),
});

const CreateScheduleBody = ScheduleBodyFields.refine(
  (d) => d.startTime < d.endTime,
  { message: "startTime must be before endTime" },
);

const UpdateScheduleBody = ScheduleBodyFields.partial();

router.post(
  "/",
  requireStaffRole("admin", "supervisor"),
  async (req: Request, res: Response) => {
    const body = CreateScheduleBody.safeParse(req.body);
    if (!body.success) {
      res
        .status(400)
        .json({ error: "Invalid request", details: body.error.flatten() });
      return;
    }

    const targetError = await validateScheduleTargets([body.data]);
    if (targetError) {
      res.status(400).json({ error: targetError });
      return;
    }

    try {
      const [schedule] = await db
        .insert(schedulesTable)
        .values({
          staffId: body.data.staffId,
          areaId: body.data.areaId ?? null,
          dayOfWeek: body.data.dayOfWeek,
          startTime: body.data.startTime,
          endTime: body.data.endTime,
          notes: body.data.notes ?? null,
        })
        .returning();

      res.json(schedule);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to create schedule" });
    }
  },
);

const BulkCreateBody = z.object({
  schedules: z.array(CreateScheduleBody),
});

router.post(
  "/bulk",
  requireStaffRole("admin", "supervisor"),
  async (req: Request, res: Response) => {
    const body = BulkCreateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    if (body.data.schedules.length === 0) {
      res.json([]);
      return;
    }

    const targetError = await validateScheduleTargets(body.data.schedules);
    if (targetError) {
      res.status(400).json({ error: targetError });
      return;
    }

    const results = await db
      .insert(schedulesTable)
      .values(
        body.data.schedules.map((s) => ({
          staffId: s.staffId,
          areaId: s.areaId ?? null,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          notes: s.notes ?? null,
        })),
      )
      .returning();

    res.json(results);
  },
);

router.put(
  "/:id",
  requireStaffRole("admin", "supervisor"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = UpdateScheduleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const hasAnyUpdate = Object.keys(body.data).length > 0;
    if (!hasAnyUpdate) {
      res.status(400).json({ error: "No schedule fields provided" });
      return;
    }

    const [existing] = await db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const timeValidation = validateScheduleTimeUpdate(
      { startTime: existing.startTime, endTime: existing.endTime },
      body.data,
      hasAnyUpdate,
    );
    if (!timeValidation.ok) {
      res.status(400).json({ error: "startTime must be before endTime" });
      return;
    }

    const targetError = await validateScheduleTargets([
      {
        staffId: body.data.staffId ?? existing.staffId,
        areaId:
          body.data.areaId === undefined ? existing.areaId : body.data.areaId,
      },
    ]);
    if (targetError) {
      res.status(400).json({ error: targetError });
      return;
    }

    const [updated] = await db
      .update(schedulesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(schedulesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    res.json(updated);
  },
);

router.delete(
  "/:id",
  requireStaffRole("admin", "supervisor"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [deleted] = await db
      .delete(schedulesTable)
      .where(eq(schedulesTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    res.json({ success: true });
  },
);

router.delete(
  "/staff/:staffId/clear",
  requireStaffRole("admin", "supervisor"),
  async (req: Request, res: Response) => {
    const staffId = Number(req.params.staffId);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      res.status(400).json({ error: "Invalid staffId" });
      return;
    }

    const result = await db
      .delete(schedulesTable)
      .where(eq(schedulesTable.staffId, staffId))
      .returning();

    res.json({ deleted: result.length });
  },
);

export default router;
