import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { schedulesTable, staffTable, areasTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { actorStaffFromRequest } from "../lib/actorSession";
import { overlaps } from "../lib/operationsPolicy";

const router: IRouter = Router();
const manager = requireStaffRole("admin", "supervisor");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fields = z.object({
  staffId: z.number().int().positive(),
  areaId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: time,
  endTime: time,
  notes: z.string().max(4000).nullable().optional(),
});
const createBody = fields.refine(
  (d) => d.startTime < d.endTime,
  "Start time must precede end time",
);

router.get("/", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const managerView = actor.role === "admin" || actor.role === "supervisor";
  const requested = req.query.staffId
    ? z.coerce.number().int().positive().safeParse(req.query.staffId)
    : null;
  if (requested && !requested.success)
    return res.status(400).json({ error: "Invalid staff id" });
  if (!managerView && requested?.data && requested.data !== actor.id)
    return res
      .status(403)
      .json({ error: "You can only view your own schedule" });
  const staffId = managerView ? requested?.data : actor.id;
  const rows = await db
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
    .innerJoin(staffTable, eq(schedulesTable.staffId, staffTable.id))
    .leftJoin(areasTable, eq(schedulesTable.areaId, areasTable.id))
    .where(
      and(
        eq(staffTable.active, true),
        eq(staffTable.formerEmployee, false),
        staffId ? eq(schedulesTable.staffId, staffId) : undefined,
      ),
    )
    .orderBy(
      schedulesTable.dayOfWeek,
      schedulesTable.startTime,
      schedulesTable.id,
    );
  // Legacy per-area rows must not multiply the hours displayed in the portal.
  const shifts = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.staffId}:${row.dayOfWeek}:${row.startTime}:${row.endTime}`;
    const existing = shifts.get(key);
    if (!existing) shifts.set(key, row);
    else
      shifts.set(key, {
        ...existing,
        areaId: null,
        areaName: "Multiple areas — see Assignments",
        areaTerminal: null,
      });
  }
  return res.json([...shifts.values()]);
});

type ShiftInput = z.infer<typeof fields>;
class ShiftConflict extends Error {}
async function saveShifts(inputs: ShiftInput[], updateId?: number) {
  return db.transaction(async (tx) => {
    // Staff locks serialize create/update/bulk writes, including absent shift rows.
    for (const staffId of [...new Set(inputs.map((s) => s.staffId))].sort(
      (a, b) => a - b,
    )) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(8104, ${staffId})`);
      const [person] = await tx
        .select()
        .from(staffTable)
        .where(eq(staffTable.id, staffId));
      if (
        !person ||
        !person.active ||
        person.formerEmployee ||
        person.role === "inspector"
      )
        throw new ShiftConflict("Choose a current employee");
    }
    const results = [];
    for (const input of inputs) {
      if (input.startTime >= input.endTime)
        throw new ShiftConflict("Start time must precede end time");
      if (input.areaId) {
        const [area] = await tx
          .select({ id: areasTable.id })
          .from(areasTable)
          .where(
            and(
              eq(areasTable.id, input.areaId),
              eq(areasTable.archived, false),
            ),
          );
        if (!area) throw new ShiftConflict("Choose an active area");
      }
      const existing = await tx
        .select()
        .from(schedulesTable)
        .where(
          and(
            eq(schedulesTable.staffId, input.staffId),
            eq(schedulesTable.dayOfWeek, input.dayOfWeek),
          ),
        );
      if (existing.some((s) => s.id !== updateId && overlaps(s, input)))
        throw new ShiftConflict(
          "This employee already has an overlapping shift. Assign additional areas under Assignments.",
        );
      const values = {
        ...input,
        areaId: input.areaId ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      };
      const [shift] = updateId
        ? await tx
            .update(schedulesTable)
            .set(values)
            .where(eq(schedulesTable.id, updateId))
            .returning()
        : await tx.insert(schedulesTable).values(values).returning();
      if (!shift) throw new ShiftConflict("Shift no longer exists");
      results.push(shift);
    }
    return results;
  });
}
router.post("/", manager, async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Invalid shift details" });
  try {
    return res.status(201).json((await saveShifts([body.data]))[0]);
  } catch (error) {
    if (error instanceof ShiftConflict)
      return res.status(409).json({ error: error.message });
    throw error;
  }
});
router.post("/bulk", manager, async (req, res) => {
  const body = z
    .object({ schedules: z.array(createBody).max(100) })
    .safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Invalid shifts (maximum 100)" });
  try {
    return res.status(201).json(await saveShifts(body.data.schedules));
  } catch (error) {
    if (error instanceof ShiftConflict)
      return res.status(409).json({ error: error.message });
    throw error;
  }
});
router.put("/:id", manager, async (req, res) => {
  const params = z.coerce.number().int().positive().safeParse(req.params.id),
    body = fields.partial().safeParse(req.body);
  if (!params.success || !body.success)
    return res.status(400).json({ error: "Invalid shift update" });
  const [current] = await db
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.id, params.data));
  if (!current) return res.status(404).json({ error: "Shift not found" });
  const full = createBody.safeParse({ ...current, ...body.data });
  if (!full.success)
    return res.status(400).json({ error: "Invalid shift times" });
  try {
    return res.json((await saveShifts([full.data], params.data))[0]);
  } catch (error) {
    if (error instanceof ShiftConflict)
      return res.status(409).json({ error: error.message });
    throw error;
  }
});
router.delete("/:id", manager, async (req, res) => {
  const params = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!params.success)
    return res.status(400).json({ error: "Invalid shift id" });
  const [deleted] = await db
    .delete(schedulesTable)
    .where(eq(schedulesTable.id, params.data))
    .returning();
  if (!deleted) return res.status(404).json({ error: "Shift not found" });
  return res.json({ success: true });
});
router.delete("/staff/:staffId/clear", manager, async (req, res) => {
  const params = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(req.params.staffId);
  if (!params.success)
    return res.status(400).json({ error: "Invalid staff id" });
  const deleted = await db
    .delete(schedulesTable)
    .where(eq(schedulesTable.staffId, params.data))
    .returning();
  return res.json({ deleted: deleted.length });
});
export default router;
