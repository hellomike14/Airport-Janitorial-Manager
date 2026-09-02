import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sharedPhotosTable, staffTable, areasTable, notificationsTable, schedulesTable } from "@workspace/db/schema";
import { eq, desc, ne, and, lte, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { StaffRow } from "../lib/actorSession";
import {
  canDeleteSharedPhoto,
  requestedStaffIdMatchesActor,
  type StaffActor,
} from "../lib/staffAuthorization";

const router: IRouter = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const photos = await db
      .select({
        id: sharedPhotosTable.id,
        staffId: sharedPhotosTable.staffId,
        imagePath: sharedPhotosTable.imagePath,
        caption: sharedPhotosTable.caption,
        areaId: sharedPhotosTable.areaId,
        latitude: sharedPhotosTable.latitude,
        longitude: sharedPhotosTable.longitude,
        takenAt: sharedPhotosTable.takenAt,
        createdAt: sharedPhotosTable.createdAt,
        staffName: staffTable.name,
        staffRole: staffTable.role,
        areaName: areasTable.name,
        areaTerminal: areasTable.terminal,
      })
      .from(sharedPhotosTable)
      .leftJoin(staffTable, eq(sharedPhotosTable.staffId, staffTable.id))
      .leftJoin(areasTable, eq(sharedPhotosTable.areaId, areasTable.id))
      .orderBy(desc(sharedPhotosTable.createdAt))
      .limit(100);

    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch photos" });
  }
});

const CreatePhotoBody = z.object({
  staffId: z.number().int().positive(),
  imagePath: z.string().min(1),
  caption: z.string().optional(),
  areaId: z.number().int().positive().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  takenAt: z.string().optional(),
});

router.post("/", async (req: Request, res: Response) => {
  const body = CreatePhotoBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
    return;
  }

  const actor = res.locals.staffActor as StaffRow;
  if (!requestedStaffIdMatchesActor(actor as StaffActor, body.data.staffId)) {
    res.status(403).json({ error: "Cannot share a photo as another staff member" });
    return;
  }

  try {
    const [photo] = await db
      .insert(sharedPhotosTable)
      .values({
        staffId: actor.id,
        imagePath: body.data.imagePath,
        caption: body.data.caption ?? null,
        areaId: body.data.areaId ?? null,
        latitude: body.data.latitude ?? null,
        longitude: body.data.longitude ?? null,
        takenAt: body.data.takenAt ? new Date(body.data.takenAt) : null,
      })
      .returning();

    const sender = await db
      .select({ name: staffTable.name })
      .from(staffTable)
      .where(eq(staffTable.id, actor.id))
      .limit(1);

    const senderName = sender[0]?.name ?? "Someone";

    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const onShiftStaff = await db
      .selectDistinct({ staffId: schedulesTable.staffId })
      .from(schedulesTable)
      .innerJoin(staffTable, eq(schedulesTable.staffId, staffTable.id))
      .where(
        and(
          eq(schedulesTable.dayOfWeek, dayOfWeek),
          lte(schedulesTable.startTime, currentTime),
          gte(schedulesTable.endTime, currentTime),
          ne(schedulesTable.staffId, actor.id),
          eq(staffTable.active, true),
          eq(staffTable.loginEnabled, true),
        )
      );

    const adminsAndSupervisors = await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(
        and(
          inArray(staffTable.role, ["admin", "supervisor"]),
          eq(staffTable.active, true),
          eq(staffTable.loginEnabled, true),
        ),
      );

    const onShiftIds = new Set(onShiftStaff.map((s) => s.staffId));
    for (const mgr of adminsAndSupervisors) {
      if (mgr.id !== actor.id) {
        onShiftIds.add(mgr.id);
      }
    }

    const recipientIds = Array.from(onShiftIds);

    if (recipientIds.length > 0) {
      const captionSnippet = body.data.caption ? `: "${body.data.caption.slice(0, 50)}"` : "";
      await db.insert(notificationsTable).values(
        recipientIds.map((staffId) => ({
          staffId,
          type: "photo_shared" as const,
          message: `📷 ${senderName} shared a photo${captionSnippet}`,
        }))
      );
    }

    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: "Failed to save photo" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const actor = res.locals.staffActor as StaffRow;

  try {
    const [photo] = await db
      .select({ staffId: sharedPhotosTable.staffId })
      .from(sharedPhotosTable)
      .where(eq(sharedPhotosTable.id, id))
      .limit(1);

    if (!photo) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }

    if (!canDeleteSharedPhoto(actor as StaffActor, photo.staffId)) {
      res.status(403).json({ error: "Not authorized to delete this shared photo" });
      return;
    }

    const [deleted] = await db
      .delete(sharedPhotosTable)
      .where(eq(sharedPhotosTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

export default router;
