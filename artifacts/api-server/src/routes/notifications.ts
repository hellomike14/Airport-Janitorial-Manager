import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable, staffTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const ListNotificationsQuery = z.object({
  staffId: z.coerce.number(),
});

const MarkAllReadBody = z.object({
  staffId: z.coerce.number(),
});

const NotificationIdParams = z.object({
  id: z.coerce.number(),
});

function formatNotification(n: any) {
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/notifications", async (req: Request, res: Response) => {
  const query = ListNotificationsQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.staffId, query.data.staffId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  res.json(notifications.map(formatNotification));
});

router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  const params = NotificationIdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.json(formatNotification(updated));
});

router.post("/notifications/mark-all-read", async (req: Request, res: Response) => {
  const body = MarkAllReadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }

  const result = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.staffId, body.data.staffId),
        eq(notificationsTable.isRead, false)
      )
    )
    .returning();

  res.json({ updated: result.length });
});

export default router;
