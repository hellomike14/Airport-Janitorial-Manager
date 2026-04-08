import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { schedulesTable, staffTable, areasTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;

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

const CreateScheduleBody = z.object({
  staffId: z.number().int().positive(),
  areaId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  endTime: z.string().regex(timeRegex, "Must be HH:mm format"),
  notes: z.string().nullable().optional(),
}).refine((d) => d.startTime < d.endTime, { message: "startTime must be before endTime" });

router.post("/", async (req: Request, res: Response) => {
  const body = CreateScheduleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
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
      }))
    )
    .returning();

  res.json(results);
});

router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = CreateScheduleBody.partial().safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
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
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
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
});

router.delete("/staff/:staffId/clear", async (req: Request, res: Response) => {
  const staffId = Number(req.params.staffId);
  if (isNaN(staffId)) {
    res.status(400).json({ error: "Invalid staffId" });
    return;
  }

  const result = await db
    .delete(schedulesTable)
    .where(eq(schedulesTable.staffId, staffId))
    .returning();

  res.json({ deleted: result.length });
});

export default router;
