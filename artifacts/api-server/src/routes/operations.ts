import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { and, eq, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  timeEntriesTable,
  timeEntryAuditTable,
  staffTable,
  areasTable,
  staffBadgesTable,
  incidentsTable,
  supplyItemsTable,
  supplyRequestsTable,
  supplyMovementsTable,
  operationsSettingsTable,
  areaChecklistsTable,
  inspectionsTable,
  monthlyReportsTable,
  assignmentsTable,
  schedulesTable,
  tasksTable,
  operationsAuditTable,
} from "@workspace/db/schema";
import { actorStaffFromRequest } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import {
  csvCell,
  gpsProblem,
  INSPECTION_CHECKS,
  inspectionScore,
  orlandoDate,
  paidMinutes,
  validDate,
} from "../lib/operationsPolicy";
import { getEffectiveTasksForArea } from "../lib/ensureTasksForDate";
import { buildMonthlyReport } from "../lib/monthlyOperationsReport";
import { lockScheduleWrites } from "../lib/scheduleLocks";

const router: IRouter = Router();
const manager = requireStaffRole("admin", "supervisor");
const admin = requireStaffRole("admin");
const date = z.string().refine(validDate, "Invalid calendar date");
const id = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(4000);
const gps = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000),
});
const range = z
  .object({ from: date, to: date })
  .refine(
    (d) =>
      d.from <= d.to && Date.parse(d.to) - Date.parse(d.from) <= 93 * 86400000,
    "Use a date range of at most 93 days",
  );
const isManager = (role: string) => role === "admin" || role === "supervisor";

router.use(requireStaffRole("admin", "supervisor", "staff"));
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/staff-options", manager, async (_req, res) => {
  res.json(
    await db
      .select({
        id: staffTable.id,
        name: staffTable.name,
        active: staffTable.active,
        formerEmployee: staffTable.formerEmployee,
      })
      .from(staffTable)
      .orderBy(staffTable.name),
  );
});

router.get("/settings", async (_req, res) => {
  const [settings] = await db
    .select()
    .from(operationsSettingsTable)
    .where(eq(operationsSettingsTable.id, 1));
  res.json(
    settings ?? {
      id: 1,
      gpsRequired: true,
      siteLatitude: 28.4312,
      siteLongitude: -81.3081,
      radiusMeters: 5000,
      maxAccuracyMeters: 200,
    },
  );
});
router.put("/settings", admin, async (req, res) => {
  const body = z
    .object({
      gpsRequired: z.boolean(),
      siteLatitude: z.number().min(-90).max(90),
      siteLongitude: z.number().min(-180).max(180),
      radiusMeters: z.number().int().min(50).max(20000),
      maxAccuracyMeters: z.number().int().min(10).max(1000),
    })
    .safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Invalid GPS settings" });
  const [settings] = await db
    .insert(operationsSettingsTable)
    .values({ id: 1, ...body.data })
    .onConflictDoUpdate({ target: operationsSettingsTable.id, set: body.data })
    .returning();
  return res.json(settings);
});

router.get("/time", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const dates = range.safeParse({
    from: req.query.from ?? orlandoDate(),
    to: req.query.to ?? orlandoDate(),
  });
  if (!dates.success)
    return res
      .status(400)
      .json({ error: "Invalid date range (maximum 93 days)" });
  const rows = await db
    .select({ entry: timeEntriesTable, staffName: staffTable.name })
    .from(timeEntriesTable)
    .innerJoin(staffTable, eq(timeEntriesTable.staffId, staffTable.id))
    .where(
      and(
        gte(timeEntriesTable.workDate, dates.data.from),
        lte(timeEntriesTable.workDate, dates.data.to),
        isManager(actor.role)
          ? undefined
          : eq(timeEntriesTable.staffId, actor.id),
      ),
    )
    .orderBy(desc(timeEntriesTable.clockIn));
  return res.json(
    rows.map((r) => ({
      ...r.entry,
      staffName: r.staffName,
      paidMinutes: paidMinutes(r.entry),
    })),
  );
});
router.get("/time/current", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const [entry] = await db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.staffId, actor.id),
        sql`${timeEntriesTable.clockOut} IS NULL`,
      ),
    );
  res.json(entry ?? null);
});
router.post("/time/clock-in", async (req, res) => {
  const body = gps.safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "A current GPS position is required" });
  const actor = (await actorStaffFromRequest(req))!;
  const [settings] = await db
    .select()
    .from(operationsSettingsTable)
    .where(eq(operationsSettingsTable.id, 1));
  const problem = gpsProblem(
    body.data,
    settings ?? {
      gpsRequired: true,
      siteLatitude: 28.4312,
      siteLongitude: -81.3081,
      radiusMeters: 5000,
      maxAccuracyMeters: 200,
    },
  );
  if (problem) return res.status(400).json({ error: problem });
  try {
    const entry = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(8105, ${actor.id})`);
      const [entry] = await tx
        .insert(timeEntriesTable)
        .values({
          staffId: actor.id,
          workDate: orlandoDate(),
          clockIn: new Date(),
          inLatitude: body.data.latitude,
          inLongitude: body.data.longitude,
          inAccuracy: body.data.accuracy,
        })
        .returning();
      return entry;
    });
    return res.status(201).json(entry);
  } catch (error) {
    if (
      (error as { cause?: { code?: string }; code?: string }).cause?.code ===
        "23505" ||
      (error as { code?: string }).code === "23505"
    )
      return res
        .status(409)
        .json({ error: "You already have an open time entry" });
    throw error;
  }
});
router.post("/time/clock-out", async (req, res) => {
  const body = gps
    .extend({ breakMinutes: z.number().int().min(0).max(1440).default(0) })
    .safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({
        error:
          "A current GPS position and valid unpaid break minutes are required",
      });
  const actor = (await actorStaffFromRequest(req))!;
  const entry = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8105, ${actor.id})`);
    const [open] = await tx
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.staffId, actor.id),
          sql`${timeEntriesTable.clockOut} IS NULL`,
        ),
      )
      .for("update");
    if (!open) return null;
    const now = new Date();
    if (
      body.data.breakMinutes >
      Math.floor((now.getTime() - open.clockIn.getTime()) / 60000)
    )
      return "invalid_break";
    const [closed] = await tx
      .update(timeEntriesTable)
      .set({
        clockOut: now,
        outLatitude: body.data.latitude,
        outLongitude: body.data.longitude,
        outAccuracy: body.data.accuracy,
        breakMinutes: body.data.breakMinutes,
      })
      .where(eq(timeEntriesTable.id, open.id))
      .returning();
    return closed;
  });
  if (!entry) return res.status(409).json({ error: "No open time entry" });
  if (entry === "invalid_break")
    return res.status(400).json({ error: "Unpaid break exceeds time worked" });
  return res.json(entry);
});
router.patch("/time/:id/correct", manager, async (req, res) => {
  const entryId = id.safeParse(req.params.id);
  const body = z
    .object({
      clockIn: z.string().datetime({ offset: true }),
      clockOut: z.string().datetime({ offset: true }),
      breakMinutes: z.number().int().min(0).max(1440),
      reason: text,
    })
    .safeParse(req.body);
  if (!entryId.success || !body.success)
    return res
      .status(400)
      .json({ error: "Invalid correction; include a reason" });
  const input = body.data;
  const clockIn = new Date(input.clockIn),
    clockOut = new Date(input.clockOut);
  if (
    clockOut <= clockIn ||
    clockOut > new Date() ||
    input.breakMinutes > (clockOut.getTime() - clockIn.getTime()) / 60000
  )
    return res
      .status(400)
      .json({ error: "Invalid clock times or break duration" });
  const actor = (await actorStaffFromRequest(req))!;
  const [owner] = await db
    .select({ staffId: timeEntriesTable.staffId })
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, entryId.data));
  if (!owner) return res.status(404).json({ error: "Time entry not found" });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8105, ${owner.staffId})`);
    const [entry] = await tx
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.id, entryId.data))
      .for("update");
    if (!entry) return null;
    const [overlap] = await tx
      .select({ id: timeEntriesTable.id })
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.staffId, entry.staffId),
          sql`${timeEntriesTable.id} <> ${entry.id}`,
          sql`${timeEntriesTable.clockIn} < ${clockOut}`,
          sql`COALESCE(${timeEntriesTable.clockOut}, now()) > ${clockIn}`,
        ),
      );
    if (overlap) return "overlap";
    const [updated] = await tx
      .update(timeEntriesTable)
      .set({
        clockIn,
        clockOut,
        workDate: orlandoDate(clockIn),
        breakMinutes: input.breakMinutes,
        correctionReason: input.reason,
        approvedById: null,
        approvedAt: null,
      })
      .where(eq(timeEntriesTable.id, entry.id))
      .returning();
    await tx
      .insert(timeEntryAuditTable)
      .values({
        entryId: entry.id,
        actorId: actor.id,
        action: "corrected",
        details: { before: entry, after: updated, reason: input.reason },
      });
    return updated;
  });
  if (!result) return res.status(404).json({ error: "Time entry not found" });
  if (result === "overlap")
    return res
      .status(409)
      .json({ error: "Correction overlaps another time entry" });
  return res.json(result);
});
router.post("/time/:id/approve", manager, async (req, res) => {
  const entryId = id.safeParse(req.params.id);
  if (!entryId.success)
    return res.status(400).json({ error: "Invalid entry id" });
  const actor = (await actorStaffFromRequest(req))!;
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.id, entryId.data))
      .for("update");
    if (!entry) return "missing";
    if (!entry.clockOut) return "open";
    if (entry.staffId === actor.id) return "self";
    if (entry.approvedAt) return entry;
    const [approved] = await tx
      .update(timeEntriesTable)
      .set({ approvedById: actor.id, approvedAt: new Date() })
      .where(eq(timeEntriesTable.id, entry.id))
      .returning();
    await tx
      .insert(timeEntryAuditTable)
      .values({
        entryId: entry.id,
        actorId: actor.id,
        action: "approved",
        details: { paidMinutes: paidMinutes(entry) },
      });
    return approved;
  });
  if (typeof result === "string")
    return res
      .status(result === "missing" ? 404 : 409)
      .json({
        error:
          result === "self"
            ? "Another manager must approve your time"
            : result === "open"
              ? "Clock out before approval"
              : "Time entry not found",
      });
  return res.json(result);
});
router.get("/payroll.csv", admin, async (req, res) => {
  const dates = range.safeParse(req.query);
  if (!dates.success)
    return res
      .status(400)
      .json({ error: "Choose a valid date range of at most 93 days" });
  const entries = await db
    .select({ entry: timeEntriesTable, name: staffTable.name })
    .from(timeEntriesTable)
    .innerJoin(staffTable, eq(timeEntriesTable.staffId, staffTable.id))
    .where(
      and(
        gte(timeEntriesTable.workDate, dates.data.from),
        lte(timeEntriesTable.workDate, dates.data.to),
        sql`${timeEntriesTable.approvedAt} IS NOT NULL`,
        sql`${timeEntriesTable.clockOut} IS NOT NULL`,
      ),
    )
    .orderBy(staffTable.name, timeEntriesTable.clockIn);
  const csv = [
    [
      "Staff ID",
      "Employee",
      "Work date (Orlando)",
      "Clock in (UTC)",
      "Clock out (UTC)",
      "Unpaid break minutes",
      "Approved hours",
      "Approved by ID",
    ],
    ...entries.map(({ entry: e, name }) => [
      e.staffId,
      name,
      e.workDate,
      e.clockIn.toISOString(),
      e.clockOut!.toISOString(),
      e.breakMinutes,
      (paidMinutes(e) / 60).toFixed(4),
      e.approvedById!,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="marvol-payroll-${dates.data.from}-${dates.data.to}.csv"`,
  );
  return res.type("text/csv").send(csv);
});

router.get("/badges", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const rows = await db
    .select({
      badge: staffBadgesTable,
      name: staffTable.name,
      active: staffTable.active,
      formerEmployee: staffTable.formerEmployee,
    })
    .from(staffBadgesTable)
    .innerJoin(staffTable, eq(staffBadgesTable.staffId, staffTable.id))
    .where(
      isManager(actor.role)
        ? undefined
        : eq(staffBadgesTable.staffId, actor.id),
    );
  const today = orlandoDate();
  res.json(
    rows.map((r) => ({
      ...r.badge,
      staffName: r.name,
      active: r.active,
      formerEmployee: r.formerEmployee,
      daysUntilExpiry: Math.ceil(
        (Date.parse(r.badge.expiresOn) - Date.parse(today)) / 86400000,
      ),
      returnRequired: (!r.active || r.formerEmployee) && !r.badge.returnedOn,
    })),
  );
});
router.put("/badges/:staffId", admin, async (req, res) => {
  const staffId = id.safeParse(req.params.staffId);
  const body = z
    .object({
      badgeNumber: text,
      expiresOn: date,
      returnedOn: date.nullable().default(null),
    })
    .safeParse(req.body);
  if (!staffId.success || !body.success)
    return res.status(400).json({ error: "Invalid badge details" });
  const [person] = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.id, staffId.data));
  if (!person) return res.status(404).json({ error: "Staff record not found" });
  const actor = (await actorStaffFromRequest(req))!;
  const values = { ...body.data, updatedById: actor.id };
  if (body.data.returnedOn && body.data.returnedOn > orlandoDate())
    return res
      .status(400)
      .json({ error: "Badge return date cannot be in the future" });
  const [badge] = await db
    .insert(staffBadgesTable)
    .values({ staffId: staffId.data, ...values })
    .onConflictDoUpdate({ target: staffBadgesTable.staffId, set: values })
    .returning();
  return res.json(badge);
});

router.get("/incidents", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const rows = await db
    .select({
      incident: incidentsTable,
      staffName: staffTable.name,
      areaName: areasTable.name,
    })
    .from(incidentsTable)
    .innerJoin(staffTable, eq(incidentsTable.reportedById, staffTable.id))
    .innerJoin(areasTable, eq(incidentsTable.areaId, areasTable.id))
    .where(
      isManager(actor.role)
        ? undefined
        : eq(incidentsTable.reportedById, actor.id),
    )
    .orderBy(desc(incidentsTable.createdAt))
    .limit(200);
  res.json(
    rows.map((r) => ({
      ...r.incident,
      staffName: r.staffName,
      areaName: r.areaName,
    })),
  );
});
router.post("/incidents", async (req, res) => {
  const body = z
    .object({
      areaId: id,
      category: z.enum([
        "injury",
        "traffic",
        "spill",
        "bodily_fluid",
        "equipment",
        "security",
        "other",
      ]),
      severity: z.enum(["low", "medium", "high"]),
      description: text,
      immediateAction: text,
      occurredAt: z.string().datetime({ offset: true }),
    })
    .safeParse(req.body);
  if (!body.success || new Date(body.data.occurredAt) > new Date())
    return res
      .status(400)
      .json({ error: "Complete the incident details with a time in the past" });
  const [area] = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(
      and(eq(areasTable.id, body.data.areaId), eq(areasTable.archived, false)),
    );
  if (!area) return res.status(400).json({ error: "Choose an active area" });
  const actor = (await actorStaffFromRequest(req))!;
  const [incident] = await db
    .insert(incidentsTable)
    .values({
      ...body.data,
      occurredAt: new Date(body.data.occurredAt),
      reportedById: actor.id,
    })
    .returning();
  return res.status(201).json(incident);
});
router.post("/incidents/:id/close", manager, async (req, res) => {
  const incidentId = id.safeParse(req.params.id),
    body = z.object({ resolution: text }).safeParse(req.body);
  if (!incidentId.success || !body.success)
    return res.status(400).json({ error: "Resolution notes required" });
  const actor = (await actorStaffFromRequest(req))!;
  const [closed] = await db
    .update(incidentsTable)
    .set({
      status: "closed",
      resolution: body.data.resolution,
      closedAt: new Date(),
      closedById: actor.id,
    })
    .where(
      and(
        eq(incidentsTable.id, incidentId.data),
        eq(incidentsTable.status, "open"),
      ),
    )
    .returning();
  if (!closed)
    return res
      .status(409)
      .json({ error: "Incident is missing or already closed" });
  return res.json(closed);
});

router.get("/supplies", async (_req, res) => {
  res.json(
    await db.select().from(supplyItemsTable).orderBy(supplyItemsTable.name),
  );
});
router.post("/supplies", manager, async (req, res) => {
  const body = z
    .object({
      name: text,
      unit: z.string().trim().min(1).max(100),
      stock: z.number().int().min(0),
      reorderLevel: z.number().int().min(0),
    })
    .safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Invalid stock item" });
  const actor = (await actorStaffFromRequest(req))!;
  const item = await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(supplyItemsTable)
      .values(body.data)
      .returning();
    await tx
      .insert(supplyMovementsTable)
      .values({
        itemId: item.id,
        actorId: actor.id,
        quantity: item.stock,
        reason: "Opening stock",
      });
    return item;
  });
  return res.status(201).json(item);
});
router.post("/supplies/:id/adjust", manager, async (req, res) => {
  const itemId = id.safeParse(req.params.id),
    body = z
      .object({
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((n) => n !== 0),
        reason: text,
        reorderLevel: z.number().int().min(0).optional(),
      })
      .safeParse(req.body);
  if (!itemId.success || !body.success)
    return res
      .status(400)
      .json({ error: "A stock change and reason are required" });
  const actor = (await actorStaffFromRequest(req))!;
  const updated = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(supplyItemsTable)
      .where(eq(supplyItemsTable.id, itemId.data))
      .for("update");
    if (!item || item.stock + body.data.quantity < 0) return null;
    const [updated] = await tx
      .update(supplyItemsTable)
      .set({
        stock: item.stock + body.data.quantity,
        ...(body.data.reorderLevel !== undefined
          ? { reorderLevel: body.data.reorderLevel }
          : {}),
      })
      .where(eq(supplyItemsTable.id, item.id))
      .returning();
    await tx
      .insert(supplyMovementsTable)
      .values({
        itemId: item.id,
        actorId: actor.id,
        quantity: body.data.quantity,
        reason: body.data.reason,
      });
    return updated;
  });
  if (!updated)
    return res
      .status(409)
      .json({ error: "Item is missing or stock would become negative" });
  return res.json(updated);
});
router.get("/supply-requests", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const rows = await db
    .select({
      request: supplyRequestsTable,
      itemName: supplyItemsTable.name,
      unit: supplyItemsTable.unit,
      staffName: staffTable.name,
    })
    .from(supplyRequestsTable)
    .innerJoin(
      supplyItemsTable,
      eq(supplyRequestsTable.itemId, supplyItemsTable.id),
    )
    .innerJoin(staffTable, eq(supplyRequestsTable.staffId, staffTable.id))
    .where(
      isManager(actor.role)
        ? undefined
        : eq(supplyRequestsTable.staffId, actor.id),
    )
    .orderBy(desc(supplyRequestsTable.createdAt))
    .limit(200);
  res.json(
    rows.map((r) => ({
      ...r.request,
      itemName: r.itemName,
      unit: r.unit,
      staffName: r.staffName,
    })),
  );
});
router.post("/supply-requests", async (req, res) => {
  const body = z
    .object({
      itemId: id,
      quantity: z.number().int().min(1).max(100000),
      notes: z.string().max(4000).optional(),
    })
    .safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "Select a supply and positive quantity" });
  const [item] = await db
    .select({ id: supplyItemsTable.id })
    .from(supplyItemsTable)
    .where(eq(supplyItemsTable.id, body.data.itemId));
  if (!item) return res.status(404).json({ error: "Supply item not found" });
  const actor = (await actorStaffFromRequest(req))!;
  const [request] = await db
    .insert(supplyRequestsTable)
    .values({ ...body.data, staffId: actor.id })
    .returning();
  return res.status(201).json(request);
});
router.post("/supply-requests/:id/handle", manager, async (req, res) => {
  const requestId = id.safeParse(req.params.id),
    body = z
      .object({ status: z.enum(["fulfilled", "declined"]) })
      .safeParse(req.body);
  if (!requestId.success || !body.success)
    return res.status(400).json({ error: "Invalid request action" });
  const actor = (await actorStaffFromRequest(req))!;
  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(supplyRequestsTable)
      .where(eq(supplyRequestsTable.id, requestId.data))
      .for("update");
    if (!request || request.status !== "pending") return null;
    if (body.data.status === "fulfilled") {
      const [item] = await tx
        .select()
        .from(supplyItemsTable)
        .where(eq(supplyItemsTable.id, request.itemId))
        .for("update");
      if (!item || item.stock < request.quantity) return null;
      await tx
        .update(supplyItemsTable)
        .set({ stock: item.stock - request.quantity })
        .where(eq(supplyItemsTable.id, item.id));
      await tx
        .insert(supplyMovementsTable)
        .values({
          itemId: item.id,
          actorId: actor.id,
          quantity: -request.quantity,
          reason: `Fulfilled request ${request.id}`,
        });
    }
    const [updated] = await tx
      .update(supplyRequestsTable)
      .set({ status: body.data.status, handledById: actor.id })
      .where(eq(supplyRequestsTable.id, request.id))
      .returning();
    return updated;
  });
  if (!result)
    return res
      .status(409)
      .json({
        error: "Request is no longer pending, or stock is insufficient",
      });
  return res.json(result);
});

router.get("/checklists/:areaId", manager, async (req, res) => {
  const areaId = id.safeParse(req.params.areaId);
  if (!areaId.success) return res.status(400).json({ error: "Invalid area" });
  const [checklist] = await db
    .select()
    .from(areaChecklistsTable)
    .where(eq(areaChecklistsTable.areaId, areaId.data));
  if (checklist) return res.json(checklist);
  const items = await getEffectiveTasksForArea(areaId.data);
  return res.json({
    areaId: areaId.data,
    items: items.map((t) => ({
      taskName: t.taskName,
      photoRequired: t.photoRequired ?? false,
      notes: t.notes,
    })),
    isCustom: false,
  });
});
router.put("/checklists/:areaId", admin, async (req, res) => {
  const areaId = id.safeParse(req.params.areaId);
  const body = z
    .object({
      items: z
        .array(
          z.object({
            taskName: z.string().trim().min(1).max(500),
            photoRequired: z.boolean(),
            notes: z.string().max(40000).optional(),
          }),
        )
        .min(5)
        .max(7),
    })
    .safeParse(req.body);
  if (!areaId.success || !body.success)
    return res.status(400).json({ error: "Use 5–7 named checklist tasks" });
  if (
    new Set(body.data.items.map((i) => i.taskName.toLowerCase())).size !==
    body.data.items.length
  )
    return res
      .status(400)
      .json({ error: "Checklist contains duplicate task names" });
  const [area] = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(and(eq(areasTable.id, areaId.data), eq(areasTable.archived, false)));
  if (!area) return res.status(400).json({ error: "Choose an active area" });
  const actor = (await actorStaffFromRequest(req))!;
  const [checklist] = await db
    .insert(areaChecklistsTable)
    .values({
      areaId: areaId.data,
      items: body.data.items,
      updatedById: actor.id,
    })
    .onConflictDoUpdate({
      target: areaChecklistsTable.areaId,
      set: {
        items: body.data.items,
        updatedById: actor.id,
        updatedAt: new Date(),
      },
    })
    .returning();
  return res.json(checklist);
});

router.get("/inspections", manager, async (_req, res) => {
  const rows = await db
    .select({
      inspection: inspectionsTable,
      areaName: areasTable.name,
      staffName: staffTable.name,
    })
    .from(inspectionsTable)
    .innerJoin(areasTable, eq(inspectionsTable.areaId, areasTable.id))
    .innerJoin(staffTable, eq(inspectionsTable.inspectedById, staffTable.id))
    .orderBy(desc(inspectionsTable.createdAt))
    .limit(200);
  res.json({
    checks: INSPECTION_CHECKS,
    target: 90,
    inspections: rows.map((r) => ({
      ...r.inspection,
      areaName: r.areaName,
      staffName: r.staffName,
    })),
  });
});
router.post("/inspections", manager, async (req, res) => {
  const body = z
    .object({
      areaId: id,
      inspectionDate: date,
      checks: z.array(z.boolean()).length(15),
      notes: z.string().max(4000).optional(),
    })
    .safeParse(req.body);
  if (!body.success || body.data.inspectionDate > orlandoDate())
    return res
      .status(400)
      .json({
        error: "Complete all 15 checks and use today's date or earlier",
      });
  const [area] = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(
      and(eq(areasTable.id, body.data.areaId), eq(areasTable.archived, false)),
    );
  if (!area) return res.status(400).json({ error: "Choose an active area" });
  const actor = (await actorStaffFromRequest(req))!;
  const [inspection] = await db
    .insert(inspectionsTable)
    .values({
      ...body.data,
      inspectedById: actor.id,
      score: inspectionScore(body.data.checks),
    })
    .returning();
  return res.status(201).json(inspection);
});

router.get("/monthly-report/:month", manager, async (req, res) => {
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .safeParse(req.params.month);
  if (!month.success) return res.status(400).json({ error: "Use YYYY-MM" });
  const [saved] = await db
    .select()
    .from(monthlyReportsTable)
    .where(eq(monthlyReportsTable.month, month.data));
  return res.json(saved?.report ?? (await buildMonthlyReport(month.data)));
});
router.post("/monthly-report/:month/refresh", admin, async (req, res) => {
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .safeParse(req.params.month);
  if (!month.success) return res.status(400).json({ error: "Use YYYY-MM" });
  const report = await buildMonthlyReport(month.data);
  await db
    .insert(monthlyReportsTable)
    .values({ month: month.data, report })
    .onConflictDoUpdate({
      target: monthlyReportsTable.month,
      set: { report, generatedAt: new Date() },
    });
  return res.json(report);
});

router.get("/audit", manager, async (req, res) => {
  const day = date.safeParse(req.query.date ?? orlandoDate());
  if (!day.success) return res.status(400).json({ error: "Invalid date" });
  const [staff, areas, assignments, schedules, duplicates] = await Promise.all([
    db.select().from(staffTable),
    db.select().from(areasTable),
    db
      .select()
      .from(assignmentsTable)
      .where(eq(assignmentsTable.assignmentDate, day.data)),
    db.select().from(schedulesTable),
    db
      .select({
        areaId: tasksTable.areaId,
        taskName: tasksTable.taskName,
        copies: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .where(eq(tasksTable.taskDate, day.data))
      .groupBy(tasksTable.areaId, tasksTable.taskName, tasksTable.isSpecial)
      .having(sql`count(*) > 1`),
  ]);
  const current = new Set(
    staff.filter((s) => s.active && !s.formerEmployee).map((s) => s.id),
  );
  const activeAreas = areas.filter((a) => !a.archived);
  const covered = new Set(
    assignments.filter((a) => current.has(a.staffId)).map((a) => a.areaId),
  );
  const groups = new Map<string, typeof schedules>();
  for (const shift of schedules) {
    const key = `${shift.staffId}:${shift.dayOfWeek}:${shift.startTime}:${shift.endTime}`;
    groups.set(key, [...(groups.get(key) ?? []), shift]);
  }
  return res.json({
    date: day.data,
    uncoveredAreas: activeAreas.filter((a) => !covered.has(a.id)),
    ineligibleSchedules: schedules
      .filter((s) => !current.has(s.staffId))
      .map((s) => ({
        ...s,
        staffName:
          staff.find((p) => p.id === s.staffId)?.name ?? "Missing staff record",
      })),
    duplicateShifts: [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({
        staffName: staff.find((s) => s.id === g[0].staffId)?.name,
        staffId: g[0].staffId,
        dayOfWeek: g[0].dayOfWeek,
        startTime: g[0].startTime,
        endTime: g[0].endTime,
        ids: g.map((s) => s.id),
      })),
    duplicateTasks: duplicates,
    archivedAreas: areas.filter((a) => a.archived),
    missingStaffEmails: staff
      .filter((s) => s.active && !s.formerEmployee && !s.email?.trim())
      .map((s) => ({ id: s.id, name: s.name })),
  });
});
router.post("/schedules/consolidate", admin, async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  // Exact staff/day/time matches only. Area coverage remains in assignments.
  // Ambiguous overlapping shifts require an administrator to resolve them individually.
  const result = await db.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    await tx.execute(sql`LOCK TABLE schedules IN SHARE ROW EXCLUSIVE MODE`);
    const rows = await tx.select().from(schedulesTable).for("update");
    const groups = new Map<string, typeof rows>();
    for (const shift of rows) {
      const key = `${shift.staffId}:${shift.dayOfWeek}:${shift.startTime}:${shift.endTime}`;
      groups.set(key, [...(groups.get(key) ?? []), shift]);
    }
    let removed = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.id - b.id);
      const [keep, ...extras] = group;
      const notes = [
        ...new Set(group.map((s) => s.notes?.trim()).filter(Boolean)),
      ].join("\n");
      await tx
        .update(schedulesTable)
        .set({ areaId: null, notes: notes || null, updatedAt: new Date() })
        .where(eq(schedulesTable.id, keep.id));
      await tx
        .insert(operationsAuditTable)
        .values({
          actorId: actor.id,
          action: "consolidated_shifts",
          details: { retainedId: keep.id, originalShifts: group },
        });
      await tx.delete(schedulesTable).where(
        inArray(
          schedulesTable.id,
          extras.map((s) => s.id),
        ),
      );
      removed += extras.length;
    }
    return { removed };
  });
  return res.json(result);
});
export default router;
