import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { taskTypesTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const SEED_TASKS = [
  "Routine sweep of all levels — remove debris, trash, and litter",
  "Mop and sanitize all floor surfaces — extra attention to high-traffic zones",
  "Deep clean stairwells — scrub landings, steps, and corners",
  "Clean and sanitize elevator cabs — floors, walls, buttons, and tracks",
  "Sanitize all handrails, elevator buttons, and high-touch surfaces",
  "Empty all trash receptacles and replace liners",
  "Spot clean walls, pillars, signs, and partitions",
  "Remove gum, stains, and debris from floor surfaces",
  "Clean entry/exit areas, doors, and glass partitions",
  "Inspect and clean drainage grates and floor drains",
  "Inspect and report any maintenance issues or safety hazards",
  "Final supervisor inspection walk-through and sign-off",
];

async function ensureSeeded() {
  const existing = await db.select({ id: taskTypesTable.id }).from(taskTypesTable).limit(1);
  if (existing.length === 0) {
    await db.insert(taskTypesTable).values(
      SEED_TASKS.map((name, idx) => ({
        taskName: name,
        taskOrder: idx + 1,
        active: true,
      }))
    );
  }
}

const CreateBody = z.object({
  taskName: z.string().min(1),
  taskOrder: z.number().optional(),
});

const UpdateBody = z.object({
  taskName: z.string().min(1).optional(),
  taskOrder: z.number().optional(),
  active: z.boolean().optional(),
});

const IdParams = z.object({ id: z.coerce.number() });

const ReorderBody = z.object({
  orderedIds: z.array(z.number()),
});

function fmt(t: any) {
  return { ...t, createdAt: t.createdAt.toISOString() };
}

router.get("/task-types", async (req: Request, res: Response) => {
  await ensureSeeded();
  const types = await db
    .select()
    .from(taskTypesTable)
    .orderBy(asc(taskTypesTable.taskOrder), asc(taskTypesTable.id));
  res.json(types.map(fmt));
});

router.post("/task-types", async (req: Request, res: Response) => {
  const body = CreateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const all = await db.select({ taskOrder: taskTypesTable.taskOrder }).from(taskTypesTable).orderBy(asc(taskTypesTable.taskOrder));
  const maxOrder = all.length > 0 ? Math.max(...all.map((t) => t.taskOrder)) : 0;

  const [created] = await db
    .insert(taskTypesTable)
    .values({
      taskName: body.data.taskName,
      taskOrder: body.data.taskOrder ?? maxOrder + 1,
      active: true,
    })
    .returning();

  res.status(201).json(fmt(created));
});

router.put("/task-types/:id", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  const body = UpdateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const updates: Record<string, any> = {};
  if (body.data.taskName !== undefined) updates.taskName = body.data.taskName;
  if (body.data.taskOrder !== undefined) updates.taskOrder = body.data.taskOrder;
  if (body.data.active !== undefined) updates.active = body.data.active;

  const [updated] = await db
    .update(taskTypesTable)
    .set(updates)
    .where(eq(taskTypesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Task type not found" });
    return;
  }

  res.json(fmt(updated));
});

router.delete("/task-types/:id", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(taskTypesTable)
    .where(eq(taskTypesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Task type not found" });
    return;
  }

  res.json({ success: true });
});

router.post("/task-types/reorder", async (req: Request, res: Response) => {
  const body = ReorderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "orderedIds is required" });
    return;
  }

  await Promise.all(
    body.data.orderedIds.map((id, idx) =>
      db.update(taskTypesTable).set({ taskOrder: idx + 1 }).where(eq(taskTypesTable.id, id))
    )
  );

  res.json({ updated: body.data.orderedIds.length });
});

export default router;
