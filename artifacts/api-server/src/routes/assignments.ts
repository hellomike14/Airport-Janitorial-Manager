import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  assignmentsTable,
  staffTable,
  areasTable,
  schedulesTable,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  ListAssignmentsQueryParams,
  CreateAssignmentBody,
  DeleteAssignmentParams,
} from "@workspace/api-zod";
import type { StaffRow } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const actor = res.locals.staffActor as StaffRow;
  const query = ListAssignmentsQueryParams.parse({
    date: req.query.date,
    staffId: req.query.staffId,
  });

  const today = new Date().toISOString().split("T")[0];
  const date = query.date ?? today;
  // Only managers receive the roster. Staff and inspectors are limited to
  // their own record even if they claim another id or omit the filter.
  const isManager = actor.role === "admin" || actor.role === "supervisor";
  const staffId = isManager ? query.staffId : actor.id;

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
      and(
        eq(assignmentsTable.staffId, staffTable.id),
        eq(staffTable.active, true),
      ),
    )
    .innerJoin(areasTable, eq(assignmentsTable.areaId, areasTable.id))
    .where(
      and(
        eq(assignmentsTable.assignmentDate, date),
        staffId !== undefined ? eq(assignmentsTable.staffId, staffId) : undefined,
      ),
    );

  const supervisorIds = [
    ...new Set(assignments.map((a) => a.assignedById).filter(Boolean)),
  ] as number[];
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
    })),
  );
});

router.post("/", requireStaffRole("admin", "supervisor"), async (req, res) => {
  const actor = res.locals.staffActor as StaffRow;
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = parsed.data;

  const assignDate = new Date(`${body.assignmentDate}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(body.assignmentDate) ||
    Number.isNaN(assignDate.getTime()) ||
    assignDate.toISOString().slice(0, 10) !== body.assignmentDate
  ) {
    res.status(400).json({ error: "Invalid assignmentDate" });
    return;
  }

  const [targetStaff] = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(
      and(
        eq(staffTable.id, body.staffId),
        eq(staffTable.role, "staff"),
        eq(staffTable.active, true),
      ),
    );
  if (!targetStaff) {
    res.status(400).json({ error: "Invalid or inactive staffId" });
    return;
  }

  const [targetArea] = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(and(eq(areasTable.id, body.areaId), eq(areasTable.archived, false)));
  if (!targetArea) {
    res.status(400).json({ error: "Invalid or archived areaId" });
    return;
  }

  const dayOfWeek = assignDate.getUTCDay();
  const created = await db.transaction(async (tx) => {
    // There is no database uniqueness constraint on daily assignments, so
    // serialize this natural key and make retries idempotent.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`assignment:${body.staffId}:${body.areaId}:${body.assignmentDate}`}))`,
    );

    const [existingAssignment] = await tx
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.staffId, body.staffId),
          eq(assignmentsTable.areaId, body.areaId),
          eq(assignmentsTable.assignmentDate, body.assignmentDate),
        ),
      )
      .limit(1);

    const assignment = existingAssignment
      ? existingAssignment
      : (
          await tx
            .insert(assignmentsTable)
            .values({
              staffId: body.staffId,
              areaId: body.areaId,
              assignmentDate: body.assignmentDate,
              // Never trust the client-supplied assignedById; the authenticated
              // actor is the authoritative audit identity.
              assignedById: actor.id,
              notes: body.notes ?? null,
              isSpecial: body.isSpecial,
            })
            .returning()
        )[0];

    const existingSchedule = await tx
      .select({ id: schedulesTable.id })
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.staffId, body.staffId),
          eq(schedulesTable.dayOfWeek, dayOfWeek),
          eq(schedulesTable.areaId, body.areaId),
        ),
      )
      .limit(1);

    if (existingSchedule.length === 0) {
      const existingShift = await tx
        .select({
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
        })
        .from(schedulesTable)
        .where(eq(schedulesTable.staffId, body.staffId))
        .orderBy(schedulesTable.dayOfWeek, schedulesTable.startTime)
        .limit(1);

      await tx.insert(schedulesTable).values({
        staffId: body.staffId,
        areaId: body.areaId,
        dayOfWeek,
        startTime: existingShift[0]?.startTime ?? "14:00",
        endTime: existingShift[0]?.endTime ?? "22:00",
        notes: body.notes ?? null,
      });
    }

    return assignment;
  });

  const [staff] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, created.staffId));

  const [area] = await db
    .select({ name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.id, created.areaId));

  const [supervisor] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, created.assignedById));

  res.status(201).json({
    ...created,
    staffName: staff?.name ?? "",
    areaName: area?.name ?? "",
    terminal: area?.terminal ?? "",
    assignedByName: supervisor?.name ?? "",
    createdAt: created.createdAt.toISOString(),
  });
});

router.delete(
  "/:id",
  requireStaffRole("admin", "supervisor"),
  async (req, res) => {
    const { id } = DeleteAssignmentParams.parse({ id: req.params.id });
    await db.delete(assignmentsTable).where(eq(assignmentsTable.id, id));
    res.json({ success: true });
  },
);

export default router;
