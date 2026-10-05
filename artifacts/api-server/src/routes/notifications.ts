import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable, staffTable, issuesTable, tasksTable } from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";

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
    taskId: n.taskId ?? null,
    beforeImagePath: n.beforeImagePath ?? null,
    afterImagePath: n.afterImagePath ?? null,
  };
}

router.get("/notifications", async (req: Request, res: Response) => {
  const query = ListNotificationsQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }

  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (actor.id !== query.data.staffId) {
    res.status(403).json({ error: "Cannot view another staff member's notifications" });
    return;
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.staffId, query.data.staffId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const issueNotificationIds = notifications
    .filter((n) => n.issueId != null && ["new_issue", "issue_assigned", "issue_completed", "inspector_to_supervisor", "supervisor_to_inspector"].includes(n.type))
    .map((n) => n.issueId!);
  const taskNotificationIds = notifications
    .filter((n) => n.taskId != null && n.type === "task_completed")
    .map((n) => n.taskId!);
  const [issuePhotos, taskPhotos] = await Promise.all([
    issueNotificationIds.length
      ? db.select({ id: issuesTable.id, beforeImagePath: issuesTable.beforeImagePath, afterImagePath: issuesTable.afterImagePath })
        .from(issuesTable).where(inArray(issuesTable.id, issueNotificationIds))
      : [],
    taskNotificationIds.length
      ? db.select({ id: tasksTable.id, beforeImagePath: tasksTable.beforeImagePath, afterImagePath: tasksTable.afterImagePath })
        .from(tasksTable).where(inArray(tasksTable.id, taskNotificationIds))
      : [],
  ]);
  const issuePhotoById = new Map(issuePhotos.map((row) => [row.id, row]));
  const taskPhotoById = new Map(taskPhotos.map((row) => [row.id, row]));

  res.json(notifications.map((notification) => {
    const isIssueNotification = notification.issueId != null &&
      ["new_issue", "issue_assigned", "issue_completed", "inspector_to_supervisor", "supervisor_to_inspector"].includes(notification.type);
    const isTaskNotification = notification.taskId != null && notification.type === "task_completed";
    const photos = isIssueNotification
      ? issuePhotoById.get(notification.issueId!)
      : isTaskNotification
        ? taskPhotoById.get(notification.taskId!)
        : undefined;
    return formatNotification({
      ...notification,
      beforeImagePath: photos?.beforeImagePath ?? null,
      afterImagePath: photos?.afterImagePath ?? null,
    });
  }));
});

router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  const params = NotificationIdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, params.data.id), eq(notificationsTable.staffId, actor.id)))
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
  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (actor.id !== body.data.staffId) {
    res.status(403).json({ error: "Cannot update another staff member's notifications" });
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

const SendAlertBody = z.object({
  senderId: z.number(),
  message: z.string().min(1).max(500),
  targetRole: z.enum(["supervisor", "staff", "all"]),
});

router.post("/notifications/send-alert", async (req: Request, res: Response) => {
  const body = SendAlertBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
    return;
  }

  const sender = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.id, body.data.senderId))
    .then((r) => r[0]);

  if (!sender) {
    res.status(404).json({ error: "Sender not found" });
    return;
  }

  const senderRole = sender.role;
  const allowedSenderRoles = ["inspector", "supervisor", "staff", "admin"];
  if (!allowedSenderRoles.includes(senderRole)) {
    res.status(403).json({ error: "Not authorized to send alerts" });
    return;
  }

  const allActive = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true));

  let recipients: typeof allActive = [];

  if (senderRole === "inspector" || senderRole === "admin") {
    if (body.data.targetRole === "supervisor") {
      recipients = allActive.filter((s) => (s.role === "supervisor" || s.role === "admin") && s.id !== sender.id);
    } else if (body.data.targetRole === "staff") {
      recipients = allActive.filter((s) => s.role === "staff");
    } else {
      recipients = allActive.filter((s) => (s.role === "supervisor" || s.role === "admin" || s.role === "staff") && s.id !== sender.id);
    }
  } else if (senderRole === "supervisor" || senderRole === "staff") {
    recipients = allActive.filter((s) => (s.role === "supervisor" || s.role === "admin") && s.id !== sender.id);
  }

  if (recipients.length === 0) {
    res.json({ sent: 0 });
    return;
  }

  const roleName = sender.role.charAt(0).toUpperCase() + sender.role.slice(1);
  const msg = `🔔 Alert from ${sender.name} (${roleName}): ${body.data.message}`;

  const notifs = recipients.map((s) => ({
    staffId: s.id,
    type: "direct_alert" as const,
    message: msg,
  }));

  await db.insert(notificationsTable).values(notifs);

  res.json({ sent: notifs.length });
});

export default router;
