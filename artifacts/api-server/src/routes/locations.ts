import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { staffLocationsTable, staffTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import type { StaffRow } from "../lib/actorSession";
import {
  canViewStaffLocations,
  requestedStaffIdMatchesActor,
  type StaffActor,
} from "../lib/staffAuthorization";

const router: IRouter = Router();

const UpdateLocationBody = z.object({
  staffId: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
});

router.post("/locations/update", async (req: Request, res: Response) => {
  const body = UpdateLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid location data" });
    return;
  }

  const actor = res.locals.staffActor as StaffRow;
  if (!requestedStaffIdMatchesActor(actor as StaffActor, body.data.staffId)) {
    res.status(403).json({ error: "Cannot update another staff member's location" });
    return;
  }

  const existing = await db
    .select()
    .from(staffLocationsTable)
    .where(eq(staffLocationsTable.staffId, actor.id));

  if (existing.length > 0) {
    const [updated] = await db
      .update(staffLocationsTable)
      .set({
        latitude: body.data.latitude,
        longitude: body.data.longitude,
        accuracy: body.data.accuracy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(staffLocationsTable.staffId, actor.id))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(staffLocationsTable)
      .values({
        staffId: actor.id,
        latitude: body.data.latitude,
        longitude: body.data.longitude,
        accuracy: body.data.accuracy ?? null,
      })
      .returning();
    res.json(created);
  }
});

router.get("/locations", async (_req: Request, res: Response) => {
  const actor = res.locals.staffActor as StaffRow;
  if (!canViewStaffLocations(actor as StaffActor)) {
    res.status(403).json({ error: "Not authorized to view staff locations" });
    return;
  }

  const locations = await db
    .select({
      id: staffLocationsTable.id,
      staffId: staffLocationsTable.staffId,
      staffName: staffTable.name,
      staffRole: staffTable.role,
      latitude: staffLocationsTable.latitude,
      longitude: staffLocationsTable.longitude,
      accuracy: staffLocationsTable.accuracy,
      updatedAt: staffLocationsTable.updatedAt,
    })
    .from(staffLocationsTable)
    .innerJoin(
      staffTable,
      and(eq(staffLocationsTable.staffId, staffTable.id), eq(staffTable.active, true))
    );

  res.json(
    locations.map((l) => ({
      ...l,
      updatedAt: l.updatedAt.toISOString(),
    }))
  );
});

export default router;
