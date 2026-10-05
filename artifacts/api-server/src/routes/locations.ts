import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { staffLocationsTable, staffTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";

const router: IRouter = Router();

const UpdateLocationBody = z.object({
  staffId: z.number(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(100).optional(),
});

router.post("/locations/update", async (req: Request, res: Response) => {
  const body = UpdateLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid location data" });
    return;
  }
  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (actor.id !== body.data.staffId) {
    res.status(403).json({ error: "You can only update your own location" });
    return;
  }

  const existing = await db
    .select()
    .from(staffLocationsTable)
    .where(eq(staffLocationsTable.staffId, body.data.staffId));

  if (existing.length > 0) {
    const [updated] = await db
      .update(staffLocationsTable)
      .set({
        latitude: body.data.latitude,
        longitude: body.data.longitude,
        accuracy: body.data.accuracy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(staffLocationsTable.staffId, body.data.staffId))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(staffLocationsTable)
      .values({
        staffId: body.data.staffId,
        latitude: body.data.latitude,
        longitude: body.data.longitude,
        accuracy: body.data.accuracy ?? null,
      })
      .returning();
    res.json(created);
  }
});

router.get("/locations", async (req: Request, res: Response) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (actor.role === "staff") {
    const locations = await db.select({
      id: staffLocationsTable.id, staffId: staffLocationsTable.staffId, staffName: staffTable.name, staffRole: staffTable.role,
      latitude: staffLocationsTable.latitude, longitude: staffLocationsTable.longitude, accuracy: staffLocationsTable.accuracy, updatedAt: staffLocationsTable.updatedAt,
    }).from(staffLocationsTable).innerJoin(staffTable, eq(staffLocationsTable.staffId, staffTable.id)).where(eq(staffLocationsTable.staffId, actor.id));
    return res.json(locations.map((l) => ({ ...l, updatedAt: l.updatedAt.toISOString() })));
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

  return res.json(
    locations.map((l) => ({
      ...l,
      updatedAt: l.updatedAt.toISOString(),
    }))
  );
});

export default router;
