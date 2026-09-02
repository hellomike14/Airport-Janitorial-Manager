import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  areasTable,
  taskExclusionsTable,
  tasksTable,
} from "@workspace/db/schema";
import { asc, eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  getActiveTaskTypes,
  getAreaSpecificTasks,
} from "../lib/ensureTasksForDate";
import { AREAS_REPLACING_DEFAULTS } from "../area-tasks";
import type { StaffRow } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const router: IRouter = Router();

type AreaIdentity = { name: string; terminal: string };

async function applicableTasksForArea(area: AreaIdentity) {
  const replacesDefaults = AREAS_REPLACING_DEFAULTS.has(
    `${area.terminal}::${area.name}`,
  );
  const globalTypes = replacesDefaults ? [] : await getActiveTaskTypes();
  const areaTasks = await getAreaSpecificTasks(area);
  return { globalTypes, areaTasks };
}

router.get("/", async (_req, res) => {
  const areas = await db
    .select()
    .from(areasTable)
    .where(eq(areasTable.archived, false))
    .orderBy(asc(areasTable.sortOrder));
  res.json(areas);
});

const AreaIdParams = z.object({ areaId: z.coerce.number().int().positive() });

router.get(
  "/:areaId/effective-tasks",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
    const params = AreaIdParams.safeParse({ areaId: req.params.areaId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid areaId" });
      return;
    }
    const { areaId } = params.data;

    const [area] = await db
      .select({ name: areasTable.name, terminal: areasTable.terminal })
      .from(areasTable)
      .where(and(eq(areasTable.id, areaId), eq(areasTable.archived, false)));
    if (!area) {
      res.status(404).json({ error: "Active area not found" });
      return;
    }

    const { globalTypes, areaTasks } = await applicableTasksForArea(area);
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
  },
);

const ExclusionBody = z.object({
  taskName: z.string().min(1),
  createdById: z.number().nullable().optional(),
});

router.post(
  "/:areaId/exclusions",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
    const actor = res.locals.staffActor as StaffRow;
    const params = AreaIdParams.safeParse({ areaId: req.params.areaId });
    const body = ExclusionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { areaId } = params.data;
    const { taskName } = body.data;

    const [area] = await db
      .select({ name: areasTable.name, terminal: areasTable.terminal })
      .from(areasTable)
      .where(and(eq(areasTable.id, areaId), eq(areasTable.archived, false)));
    if (!area) {
      res.status(404).json({ error: "Active area not found" });
      return;
    }

    const { globalTypes, areaTasks } = await applicableTasksForArea(area);
    const isApplicable = [...globalTypes, ...areaTasks].some(
      (t) => t.taskName === taskName,
    );
    if (!isApplicable) {
      res.status(400).json({ error: "Task name does not apply to this area" });
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`task-sheet:${areaId}:${today}`}))`,
      );
      await tx
        .insert(taskExclusionsTable)
        .values({
          areaId,
          taskName,
          // Preserve the request shape for older clients, but never trust the
          // claimed creator id for this audit field.
          createdById: actor.id,
        })
        .onConflictDoNothing();

      // Remove from today's already-generated sheet, but preserve completed
      // history and similarly named inspector requests.
      await tx
        .delete(tasksTable)
        .where(
          and(
            eq(tasksTable.areaId, areaId),
            eq(tasksTable.taskDate, today),
            eq(tasksTable.taskName, taskName),
            eq(tasksTable.completed, false),
            eq(tasksTable.isSpecial, false),
          ),
        );
    });

    res.status(201).json({ success: true });
  },
);

const RemoveExclusionBody = z.object({ taskName: z.string().min(1) });

router.post(
  "/:areaId/exclusions/remove",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
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
      .where(and(eq(areasTable.id, areaId), eq(areasTable.archived, false)));
    if (!area) {
      res.status(404).json({ error: "Active area not found" });
      return;
    }

    // Re-add to today's sheet if missing. Look up taskOrder from the task's source.
    const today = new Date().toISOString().split("T")[0];
    const { globalTypes, areaTasks } = await applicableTasksForArea(area);
    const source = [...globalTypes, ...areaTasks].find(
      (t) => t.taskName === taskName,
    );

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`task-sheet:${areaId}:${today}`}))`,
      );
      await tx
        .delete(taskExclusionsTable)
        .where(
          and(
            eq(taskExclusionsTable.areaId, areaId),
            eq(taskExclusionsTable.taskName, taskName),
          ),
        );

      if (!source) return;
      const existingToday = await tx
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.areaId, areaId),
            eq(tasksTable.taskDate, today),
            eq(tasksTable.taskName, taskName),
            eq(tasksTable.isSpecial, false),
          ),
        )
        .limit(1);

      if (existingToday.length === 0) {
        await tx.insert(tasksTable).values({
          areaId,
          taskDate: today,
          taskName: source.taskName,
          taskOrder: source.taskOrder,
          completed: false,
          isSpecial: false,
        });
      }
    });

    res.json({ success: true });
  },
);

export default router;
