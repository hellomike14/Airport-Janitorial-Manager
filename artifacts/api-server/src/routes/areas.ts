import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { areasTable, taskExclusionsTable, tasksTable, taskTypesTable } from "@workspace/db/schema";
import { asc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { getActiveTaskTypes, getAreaSpecificTasks } from "../lib/ensureTasksForDate";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const areas = await db
    .select()
    .from(areasTable)
    .where(eq(areasTable.archived, false))
    .orderBy(asc(areasTable.sortOrder));
  res.json(areas);
});

const AreaIdParams = z.object({ areaId: z.coerce.number() });

router.get("/:areaId/effective-tasks", async (req, res) => {
  const params = AreaIdParams.safeParse({ areaId: req.params.areaId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid areaId" });
    return;
  }
  const { areaId } = params.data;

  const [area] = await db
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, areaId));
  if (!area) {
    res.status(404).json({ error: "Area not found" });
    return;
  }

  const globalTypes = await getActiveTaskTypes();
  const areaTasks = await getAreaSpecificTasks(area);

  const exclusions = await db
    .select({ taskName: taskExclusionsTable.taskName })
    .from(taskExclusionsTable)
    .where(eq(taskExclusionsTable.areaId, areaId));
  const excluded = new Set(exclusions.map((e) => e.taskName));

  const merged = [
    ...globalTypes.map((t) => ({ ...t, source: "global" as const })),
    ...areaTasks.map((t) => ({ ...t, source: "area" as const })),
  ].map((t) => ({
    taskName: t.taskName,
    taskOrder: t.taskOrder,
    source: t.source,
    excluded: excluded.has(t.taskName),
  }));

  res.json(merged);
});

const ExclusionBody = z.object({
  taskName: z.string().min(1),
  createdById: z.number().nullable().optional(),
});

router.post("/:areaId/exclusions", async (req, res) => {
  const params = AreaIdParams.safeParse({ areaId: req.params.areaId });
  const body = ExclusionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { areaId } = params.data;
  const { taskName, createdById } = body.data;

  const [area] = await db
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, areaId));
  if (!area) {
    res.status(404).json({ error: "Area not found" });
    return;
  }

  const globalTypes = await getActiveTaskTypes();
  const areaTasks = await getAreaSpecificTasks(area);
  const isApplicable = [...globalTypes, ...areaTasks].some((t) => t.taskName === taskName);
  if (!isApplicable) {
    res.status(400).json({ error: "Task name does not apply to this area" });
    return;
  }

  const existing = await db
    .select({ id: taskExclusionsTable.id })
    .from(taskExclusionsTable)
    .where(and(eq(taskExclusionsTable.areaId, areaId), eq(taskExclusionsTable.taskName, taskName)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(taskExclusionsTable).values({
      areaId,
      taskName,
      createdById: createdById ?? null,
    });
  }

  // Remove from today's already-generated sheet, but only if not yet completed.
  const today = new Date().toISOString().split("T")[0];
  await db
    .delete(tasksTable)
    .where(
      and(
        eq(tasksTable.areaId, areaId),
        eq(tasksTable.taskDate, today),
        eq(tasksTable.taskName, taskName),
        eq(tasksTable.completed, false),
        eq(tasksTable.isSpecial, false),
      )
    );

  res.status(201).json({ success: true });
});

const RemoveExclusionBody = z.object({ taskName: z.string().min(1) });

router.post("/:areaId/exclusions/remove", async (req, res) => {
  const params = AreaIdParams.safeParse({ areaId: req.params.areaId });
  const body = RemoveExclusionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { areaId } = params.data;
  const { taskName } = body.data;

  const [area] = await db
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, areaId));
  if (!area) {
    res.status(404).json({ error: "Area not found" });
    return;
  }

  await db
    .delete(taskExclusionsTable)
    .where(and(eq(taskExclusionsTable.areaId, areaId), eq(taskExclusionsTable.taskName, taskName)));

  // Re-add to today's sheet if missing. Look up taskOrder from the task's source.
  const today = new Date().toISOString().split("T")[0];

  const globalTypes = await getActiveTaskTypes();
  const areaTasks = await getAreaSpecificTasks(area);
  const source = [...globalTypes, ...areaTasks].find((t) => t.taskName === taskName);

  if (source) {
    const existingToday = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.areaId, areaId),
          eq(tasksTable.taskDate, today),
          eq(tasksTable.taskName, taskName),
        )
      )
      .limit(1);

    if (existingToday.length === 0) {
      await db.insert(tasksTable).values({
        areaId,
        taskDate: today,
        taskName: source.taskName,
        taskOrder: source.taskOrder,
        completed: false,
        isSpecial: false,
      });
    }
  }

  res.json({ success: true });
});

export default router;
