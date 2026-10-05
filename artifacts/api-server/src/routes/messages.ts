import { sharedInspector, canReadSharedInspector, sharedMessageIsRead } from "../lib/sharedInspectorConversation";
import { isAllowedPair, canStart, isInspectorManager } from "../lib/conversationPolicy";
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  staffTable,
  notificationsTable,
  conversationParticipantsTable,
  messageEmailOutboxTable,
  inboundEmailMessagesTable,
  conversationArchivesTable,
  inspectorTaskLinksTable,
  inspectorTaskAssignmentHistoryTable,
  tasksTable,
  areasTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, ne, count, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { INSPECTOR_EMAIL, normalizedEmail, outboundEmailStatus, verifyInboundWebhookSecret, verifyReplyToken, inboundProviderMessageId, inboundAuthenticationPasses } from "../lib/sendgridEmailBridge";
import { autoAssignInboundInspectorMessage } from "../lib/inspectorTaskWorkflow";

const router: IRouter = Router();
/** Deliberately mounted before the staff-session router in app.ts. */
export const inboundSendgridRouter: IRouter = Router();

const StaffIdQuery = z.object({ staffId: z.coerce.number(), archived: z.enum(["true", "false"]).optional() });
const IdParams = z.object({ id: z.coerce.number() });
const StartBody = z.object({ staffId: z.number(), recipientId: z.number() });
const GroupStartBody = z.object({
  staffId: z.number(),
  recipientIds: z.array(z.number()).min(1).max(50),
  groupName: z.string().max(100).optional(),
});
const MessageBody = z.object({
  senderId: z.number(),
  body: z.string().trim().min(1).max(2000),
  clientRequestId: z.string().uuid().optional(),
});
const ReadBody = z.object({ staffId: z.coerce.number() });
const MessageParams = z.object({ id: z.coerce.number(), msgId: z.coerce.number() });
const InspectorWorkflowParams = z.object({ taskId: z.coerce.number().int().positive() });
const InboundReplyBody = z.object({
  envelope: z.object({ from: z.string(), to: z.array(z.string()).min(1) }),
  from: z.string(), text: z.string().trim().min(1).max(2000),
  headers: z.string().optional(), SPF: z.string().optional(), dkim: z.string().optional(),
}).strict();

type StaffRow = typeof staffTable.$inferSelect;
type ConversationRow = typeof conversationsTable.$inferSelect;

async function getStaff(id: number): Promise<StaffRow | undefined> {
  const [row] = await db.select().from(staffTable).where(eq(staffTable.id, id));
  return row;
}

/**
 * Resolves the authenticated actor for messaging endpoints. The caller's
 * identity comes ONLY from the verified Clerk session (mapped to a staff
 * record by email) — client-supplied staffId/senderId values are accepted
 * for API-shape compatibility but must match the authenticated actor,
 * otherwise the request is rejected.
 */
async function requireActor(req: Request, res: Response, claimedId: number): Promise<StaffRow | null> {
  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return null;
  }
  if (actor.id !== claimedId) {
    res.status(403).json({ error: "You can only act as yourself" });
    return null;
  }
  return actor;
}

async function inspectorForConversation(convo: ConversationRow) {
  if (convo.isGroup) return undefined;
  const people = await db.select().from(staffTable).where(inArray(staffTable.id, [convo.participantAId!, convo.participantBId!]));
  return sharedInspector(convo, people);
}

async function readPosition(conversationId: number, staffId: number) {
  const [position] = await db.select().from(conversationParticipantsTable).where(and(
    eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.staffId, staffId)));
  return position?.lastReadAt ?? null;
}

async function inspectorManagers() {
  return db.select({ id: staffTable.id }).from(staffTable).where(and(
    inArray(staffTable.role, ["admin", "supervisor"]), eq(staffTable.active, true),
    eq(staffTable.loginEnabled, true), eq(staffTable.formerEmployee, false)));
}

// ── 1-on-1 pair rules ─────────────────────────────────────────────────────────

// Allowed 1:1 pairs:
//   staff      ↔ admin or supervisor
//   admin      ↔ supervisor
//   supervisor ↔ inspector
// ── Summary builder ───────────────────────────────────────────────────────────

async function buildSummary(convo: ConversationRow, viewerId: number) {
  const [last] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convo.id))
    .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id))
    .limit(1);

  if (convo.isGroup) {
    // Fetch all participants with their names and read position
    const parts = await db
      .select({
        staffId: conversationParticipantsTable.staffId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
        name: staffTable.name,
        role: staffTable.role,
      })
      .from(conversationParticipantsTable)
      .innerJoin(staffTable, eq(conversationParticipantsTable.staffId, staffTable.id))
      .where(eq(conversationParticipantsTable.conversationId, convo.id));

    const viewerPart = parts.find((p) => p.staffId === viewerId);

    // Unread = messages after viewer's last_read_at, not sent by viewer
    let unread = 0;
    if (last && last.senderId !== viewerId) {
      const conditions = [
        eq(messagesTable.conversationId, convo.id),
        ne(messagesTable.senderId, viewerId),
      ];
      if (viewerPart?.lastReadAt) {
        conditions.push(gt(messagesTable.createdAt, viewerPart.lastReadAt));
      }
      const [{ value }] = await db
        .select({ value: count() })
        .from(messagesTable)
        .where(and(...conditions));
      unread = value;
    }

    const otherNames = parts.filter((p) => p.staffId !== viewerId).map((p) => p.name);
    const displayName =
      convo.groupName ||
      (otherNames.length <= 3
        ? otherNames.join(", ")
        : `${otherNames.slice(0, 3).join(", ")} +${otherNames.length - 3}`);

    return {
      id: convo.id,
      isGroup: true,
      groupName: convo.groupName ?? null,
      participantCount: parts.length,
      participantNames: otherNames,
      otherStaffId: 0,
      otherStaffName: displayName,
      otherStaffRole: "group" as const,
      lastMessage: last?.body ?? null,
      lastMessageAt: last ? last.createdAt.toISOString() : null,
      unreadCount: unread,
      createdAt: convo.createdAt.toISOString(),
    };
  }

  // Shared inspector threads retain their history and original participant IDs.
  const inspector = await inspectorForConversation(convo);
  const otherId = inspector && inspector.id !== viewerId ? inspector.id :
    convo.participantAId === viewerId ? convo.participantBId! : convo.participantAId!;
  const lastReadAt = inspector ? await readPosition(convo.id, viewerId) : null;
  const other = await getStaff(otherId);
  const [{ value: unread }] = await db
    .select({ value: count() })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, convo.id),
        inspector ? (lastReadAt ? gt(messagesTable.createdAt, lastReadAt) : undefined) : eq(messagesTable.isRead, false),
        ne(messagesTable.senderId, viewerId)
      )
    );
  return {
    id: convo.id,
    isGroup: false,
    groupName: null as string | null,
    participantCount: 2,
    participantNames: [other?.name ?? "Unknown"],
    otherStaffId: otherId,
    otherStaffName: other?.name ?? "Unknown",
    otherStaffRole: other?.role ?? ("staff" as string),
    lastMessage: last?.body ?? null,
    lastMessageAt: last ? last.createdAt.toISOString() : null,
    unreadCount: unread,
    createdAt: convo.createdAt.toISOString(),
  };
}

// ── Participant access check ───────────────────────────────────────────────────

async function loadConversationForParticipant(
  id: number,
  staffId: number
): Promise<{ status: 404 | 403; convo?: undefined } | { status?: undefined; convo: ConversationRow }> {
  const [convo] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!convo) return { status: 404 };

  if (convo.isGroup) {
    const [part] = await db
      .select()
      .from(conversationParticipantsTable)
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, id),
          eq(conversationParticipantsTable.staffId, staffId)
        )
      );
    if (!part) return { status: 403 };
  } else {
    if (convo.participantAId !== staffId && convo.participantBId !== staffId) {
      const actor = await getStaff(staffId);
      const people = await db.select().from(staffTable).where(inArray(staffTable.id, [convo.participantAId!, convo.participantBId!]));
      if (!actor || !canReadSharedInspector(actor, convo, people)) return { status: 403 };
    }
  }
  return { convo };
}

function sendConvoError(res: Response, status: 404 | 403) {
  res.status(status).json({ error: status === 404 ? "Conversation not found" : "Not a participant" });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// SendGrid must be configured to POST JSON (or a gateway must translate its
// multipart Parse payload). This endpoint intentionally accepts no unauthenticated
// browser identity and never logs headers, tokens, or email bodies.
inboundSendgridRouter.post("/", async (req: Request, res: Response) => {
  const querySecret = typeof req.query.secret === "string" ? req.query.secret : undefined;
  const presented = req.header("x-sendgrid-inbound-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? querySecret;
  if (!verifyInboundWebhookSecret(presented)) {
    res.status(401).json({ error: "Invalid webhook credential" });
    return;
  }
  const body = InboundReplyBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid inbound email" }); return; }
  const domain = process.env.SENDGRID_INBOUND_DOMAIN?.trim().toLowerCase();
  const recipient = body.data.envelope.to.map(normalizedEmail).find((address) => address?.startsWith("reply+") && address.endsWith(`@${domain}`));
  const token = recipient?.slice("reply+".length, recipient.lastIndexOf("@"));
  const claims = token ? verifyReplyToken(token, process.env.SENDGRID_REPLY_TOKEN_SECRET) : null;
  if (!claims) { res.status(403).json({ error: "Invalid or expired reply address" }); return; }
  const [inspector, supervisor, conversation] = await Promise.all([
    getStaff(claims.inspectorId), getStaff(claims.supervisorId),
    db.select().from(conversationsTable).where(eq(conversationsTable.id, claims.conversationId)).then((rows) => rows[0]),
  ]);
  if (!inspector || !supervisor || !conversation || conversation.isGroup ||
      inspector.role !== "inspector" || !isInspectorManager(supervisor.role) ||
      !inspector.active || !inspector.loginEnabled || !supervisor.active || !supervisor.loginEnabled ||
      normalizedEmail(inspector.email) !== INSPECTOR_EMAIL ||
      normalizedEmail(body.data.from) !== INSPECTOR_EMAIL ||
      normalizedEmail(body.data.envelope.from) !== INSPECTOR_EMAIL ||
      !inboundAuthenticationPasses(body.data.SPF, body.data.dkim, INSPECTOR_EMAIL)) {
    res.status(403).json({ error: "Inbound sender is not authorized" }); return;
  }
  if (!new Set([conversation.participantAId, conversation.participantBId]).has(inspector.id) ||
      !(await inspectorForConversation(conversation))) {
    res.status(403).json({ error: "Conversation is not authorized" }); return;
  }
  const providerMessageId = inboundProviderMessageId(body.data.headers, body.data);
  const result = await db.transaction(async (tx) => {
    const [claim] = await tx.insert(inboundEmailMessagesTable)
      .values({ providerMessageId, conversationId: conversation.id, senderId: inspector.id })
      .onConflictDoNothing().returning();
    if (!claim) {
      const [existing] = await tx.select({ messageId: inboundEmailMessagesTable.messageId }).from(inboundEmailMessagesTable).where(eq(inboundEmailMessagesTable.providerMessageId, providerMessageId));
      return { duplicate: true, messageId: existing?.messageId ?? null };
    }
    const [message] = await tx.insert(messagesTable).values({ conversationId: conversation.id, senderId: inspector.id, body: body.data.text }).returning();
    await tx.update(inboundEmailMessagesTable).set({ messageId: message.id }).where(eq(inboundEmailMessagesTable.providerMessageId, providerMessageId));
    const managers = await inspectorManagers();
    if (managers.length) await tx.insert(notificationsTable).values(managers.map(manager => ({ staffId: manager.id, type: "inspector_to_supervisor" as const, message: "URGENT: Inspector email reply received", isRead: false })));
    return { duplicate: false, messageId: message.id };
  });
  // A provider retry repairs a prior post-commit assignment failure. The
  // source-message unique link makes this safe and prevents duplicate tasks.
  const assignment = result.messageId
    ? await autoAssignInboundInspectorMessage(result.messageId, supervisor.id)
    : null;
  res.json({ ...result, assignment });
});

/**
 * Returns the narrow inspector assignment audit view.  Access is derived from
 * the Clerk actor and requires membership in the source conversation, a
 * management role, the dedicated inspector, or the currently assigned worker.
 */
router.get("/inspector-workflow/:taskId", async (req: Request, res: Response) => {
  const params = InspectorWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid task id" }); return; }
  const actor = await actorStaffFromRequest(req);
  if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
  const [row] = await db.select({
    taskId: tasksTable.id, taskName: tasksTable.taskName, completed: tasksTable.completed,
    completedAt: tasksTable.completedAt, assignedStaffId: tasksTable.assignedToId,
    sourceMessageId: inspectorTaskLinksTable.sourceMessageId, conversationId: inspectorTaskLinksTable.conversationId,
    inspectorId: inspectorTaskLinksTable.inspectorId, supervisorId: inspectorTaskLinksTable.supervisorId,
    dueAt: inspectorTaskLinksTable.dueAt, escalatedAt: inspectorTaskLinksTable.escalatedAt,
    assignmentMethod: inspectorTaskLinksTable.assignmentMethod, assignmentDistanceMeters: inspectorTaskLinksTable.assignmentDistanceMeters,
    completionMessageId: inspectorTaskLinksTable.completionMessageId, areaId: areasTable.id, areaName: areasTable.name,
    assignedStaffName: staffTable.name,
  }).from(inspectorTaskLinksTable).innerJoin(tasksTable, eq(tasksTable.id, inspectorTaskLinksTable.taskId))
    .innerJoin(areasTable, eq(areasTable.id, tasksTable.areaId)).leftJoin(staffTable, eq(staffTable.id, tasksTable.assignedToId))
    .where(eq(inspectorTaskLinksTable.taskId, params.data.taskId));
  if (!row) { res.status(404).json({ error: "Inspector workflow task not found" }); return; }
  const isParticipant = actor.id === row.inspectorId || actor.id === row.supervisorId;
  const isAuthorizedManager = isInspectorManager(actor.role);
  if (!isParticipant && !isAuthorizedManager && actor.id !== row.assignedStaffId) {
    res.status(403).json({ error: "Not authorized for this inspector workflow" }); return;
  }
  const [completionOutbox] = row.completionMessageId
    ? await db.select({ status: messageEmailOutboxTable.status }).from(messageEmailOutboxTable).where(eq(messageEmailOutboxTable.messageId, row.completionMessageId))
    : [];
  const history = await db.select({
    assignedStaffId: inspectorTaskAssignmentHistoryTable.assignedStaffId,
    assignedById: inspectorTaskAssignmentHistoryTable.assignedById,
    event: inspectorTaskAssignmentHistoryTable.event, method: inspectorTaskAssignmentHistoryTable.method,
    distanceMeters: inspectorTaskAssignmentHistoryTable.distanceMeters, provenance: inspectorTaskAssignmentHistoryTable.provenance,
    createdAt: inspectorTaskAssignmentHistoryTable.createdAt,
  }).from(inspectorTaskAssignmentHistoryTable).where(eq(inspectorTaskAssignmentHistoryTable.taskId, row.taskId)).orderBy(asc(inspectorTaskAssignmentHistoryTable.id));
  const now = Date.now();
  res.json({
    source: { conversationId: row.conversationId, messageId: row.sourceMessageId },
    task: { id: row.taskId, name: row.taskName, completed: row.completed, completedAt: row.completedAt?.toISOString() ?? null },
    area: { id: row.areaId, name: row.areaName },
    assignedStaff: row.assignedStaffId ? { id: row.assignedStaffId, name: row.assignedStaffName } : null,
    assignmentMethod: row.assignmentMethod, assignmentDistanceMeters: row.assignmentDistanceMeters,
    dueAt: row.dueAt.toISOString(), remainingSeconds: Math.max(0, Math.ceil((row.dueAt.getTime() - now) / 1000)),
    status: row.completed ? "completed" : row.escalatedAt ? "escalated" : row.dueAt.getTime() <= now ? "overdue" : "assigned",
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    history: history.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    completionEmailDeliveryStatus: completionOutbox?.status ?? null,
  });
});

router.get("/conversations", async (req: Request, res: Response) => {
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId, archived: req.query.archived });
  if (!query.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;
  const staffId = actor.id;

  // 1:1 conversations
  const oneToOne = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.isGroup, false),
        or(
          eq(conversationsTable.participantAId, staffId),
          eq(conversationsTable.participantBId, staffId)
        )
      )
    );

  if (isInspectorManager(actor.role)) {
    const people = await db.select().from(staffTable);
    const inspectorIds = people.filter(p => p.role === "inspector" && normalizedEmail(p.email) === INSPECTOR_EMAIL).map(p => p.id);
    if (inspectorIds.length) {
      const candidates = await db.select().from(conversationsTable).where(and(eq(conversationsTable.isGroup, false), or(
        inArray(conversationsTable.participantAId, inspectorIds), inArray(conversationsTable.participantBId, inspectorIds))));
      for (const convo of candidates) {
        if (canReadSharedInspector(actor, convo, people) && !oneToOne.some(c => c.id === convo.id)) oneToOne.push(convo);
      }
    }
  }

  // Group conversations where this user is a participant
  const groupParticipantRows = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.staffId, staffId));

  let groupConvos: ConversationRow[] = [];
  if (groupParticipantRows.length > 0) {
    const groupIds = groupParticipantRows.map((r) => r.conversationId);
    groupConvos = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.isGroup, true), inArray(conversationsTable.id, groupIds)));
  }

  const archived = await db.select({ conversationId: conversationArchivesTable.conversationId })
    .from(conversationArchivesTable).where(eq(conversationArchivesTable.staffId, staffId));
  const archivedIds = new Set(archived.map((row) => row.conversationId));
  const showArchived = query.data.archived === "true";
  const convos = [...oneToOne, ...groupConvos].filter((convo) => archivedIds.has(convo.id) === showArchived);
  const summaries = await Promise.all(convos.map((c) => buildSummary(c, staffId)));
  summaries.sort((a, b) => {
    const ta = a.lastMessageAt ?? a.createdAt;
    const tb = b.lastMessageAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });
  res.json(summaries);
});

// Start a 1:1 conversation
router.post("/conversations", async (req: Request, res: Response) => {
  const body = StartBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "staffId and recipientId are required" });
    return;
  }
  const sender = await requireActor(req, res, body.data.staffId);
  if (!sender) return;
  const { recipientId } = body.data;
  if (sender.id === recipientId) {
    res.status(400).json({ error: "Cannot start a conversation with yourself" });
    return;
  }
  const recipient = await getStaff(recipientId);
  if (!recipient || !recipient.active) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (!canStart(sender, recipient)) {
    res.status(403).json({ error: "You are not allowed to message this person" });
    return;
  }
  // Reuse the oldest inspector thread for new messages. Existing threads stay readable.
  if (isInspectorManager(sender.role) && recipient.role === "inspector" && normalizedEmail(recipient.email) === INSPECTOR_EMAIL) {
    const candidates = await db.select().from(conversationsTable).where(and(eq(conversationsTable.isGroup, false), or(
      eq(conversationsTable.participantAId, recipient.id), eq(conversationsTable.participantBId, recipient.id)))).orderBy(asc(conversationsTable.id));
    const people = await db.select().from(staffTable);
    const shared = candidates.find(convo => canReadSharedInspector(sender, convo, people));
    if (shared) { res.json(await buildSummary(shared, sender.id)); return; }
  }
  const [aId, bId] = sender.id < recipientId ? [sender.id, recipientId] : [recipientId, sender.id];
  const [inserted] = await db
    .insert(conversationsTable)
    .values({ participantAId: aId, participantBId: bId, isGroup: false })
    .onConflictDoNothing({
      target: [conversationsTable.participantAId, conversationsTable.participantBId],
    })
    .returning();
  const convo =
    inserted ??
    (await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.participantAId, aId),
          eq(conversationsTable.participantBId, bId)
        )
      )
      .then((r) => r[0]));
  if (!convo) {
    res.status(500).json({ error: "Failed to create conversation" });
    return;
  }
  res.json(await buildSummary(convo, sender.id));
});

// Start a group conversation (admin/supervisor only)
router.post("/conversations/group", async (req: Request, res: Response) => {
  const body = GroupStartBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const sender = await requireActor(req, res, body.data.staffId);
  if (!sender) return;

  if (sender.role !== "admin" && sender.role !== "supervisor") {
    res.status(403).json({ error: "Only admins and supervisors can create group conversations" });
    return;
  }

  const { recipientIds, groupName } = body.data;
  const allIds = [...new Set([sender.id, ...recipientIds])];
  if (allIds.length < 2) {
    res.status(400).json({ error: "At least one recipient is required" });
    return;
  }

  const [convo] = await db
    .insert(conversationsTable)
    .values({ isGroup: true, groupName: groupName || null })
    .returning();

  await db.insert(conversationParticipantsTable).values(
    allIds.map((sid) => ({ conversationId: convo.id, staffId: sid }))
  );

  res.json(await buildSummary(convo, sender.id));
});

router.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;
  const result = await loadConversationForParticipant(params.data.id, actor.id);
  if (result.status !== undefined) {
    sendConvoError(res, result.status);
    return;
  }
  const shared = await inspectorForConversation(result.convo);
  const lastReadAt = shared ? await readPosition(result.convo.id, actor.id) : null;
  const rows = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      senderName: staffTable.name,
      body: messagesTable.body,
      isRead: messagesTable.isRead,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(staffTable, eq(messagesTable.senderId, staffTable.id))
    .where(eq(messagesTable.conversationId, params.data.id))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));
  const [workflowLinks, outboxRows] = await Promise.all([
    db.select({
      taskId: inspectorTaskLinksTable.taskId,
      sourceMessageId: inspectorTaskLinksTable.sourceMessageId,
      completionMessageId: inspectorTaskLinksTable.completionMessageId,
    }).from(inspectorTaskLinksTable).where(eq(inspectorTaskLinksTable.conversationId, params.data.id)),
    db.select({ messageId: messageEmailOutboxTable.messageId, status: messageEmailOutboxTable.status })
      .from(messageEmailOutboxTable).where(eq(messageEmailOutboxTable.conversationId, params.data.id)),
  ]);
  const workflowTaskByMessageId = new Map<number, number>();
  workflowLinks.forEach((link) => {
    workflowTaskByMessageId.set(link.sourceMessageId, link.taskId);
    if (link.completionMessageId) workflowTaskByMessageId.set(link.completionMessageId, link.taskId);
  });
  const deliveryByMessageId = new Map(outboxRows.map((row) => [row.messageId, row.status]));
  res.json(rows.map((m) => ({
    ...m,
    isRead: shared ? sharedMessageIsRead(m, actor.id, lastReadAt) : m.isRead,
    createdAt: m.createdAt.toISOString(),
    inspectorWorkflowTaskId: workflowTaskByMessageId.get(m.id) ?? null,
    inspectorEmailDeliveryStatus: deliveryByMessageId.get(m.id) ?? "not_applicable",
  })));
});

router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = MessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const sender = await requireActor(req, res, body.data.senderId);
  if (!sender) return;
  const result = await loadConversationForParticipant(params.data.id, sender.id);
  if (result.status !== undefined) {
    sendConvoError(res, result.status);
    return;
  }
  const { convo } = result;
  const shared = await inspectorForConversation(convo);

  // Validate sender is still allowed to send (1:1 only; group membership was
  // validated at creation time so no further pair-check is needed).
  if (!convo.isGroup) {
    const recipientId =
      shared && isInspectorManager(sender.role) ? shared.id : convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!;
    const recipient = await getStaff(recipientId);
    if (!recipient) {
      res.status(404).json({ error: "Staff member not found" });
      return;
    }
    if (!isAllowedPair(sender, recipient)) {
      res.status(403).json({ error: "You are not allowed to message this person" });
      return;
    }
  }
  if (body.data.clientRequestId) {
    const [prior] = await db.select().from(messagesTable).where(and(eq(messagesTable.senderId, sender.id), eq(messagesTable.clientRequestId, body.data.clientRequestId)));
    if (prior) {
      if (prior.conversationId !== convo.id) return res.status(409).json({ error: "clientRequestId was already used for another conversation" });
      const [priorOutbox] = await db.select({ status: messageEmailOutboxTable.status }).from(messageEmailOutboxTable).where(eq(messageEmailOutboxTable.messageId, prior.id));
      return res.status(200).json({ id: prior.id, conversationId: prior.conversationId, senderId: prior.senderId, senderName: sender.name, body: prior.body, isRead: prior.isRead, createdAt: prior.createdAt.toISOString(), inspectorWorkflowTaskId: null, inspectorEmailDeliveryStatus: priorOutbox?.status ?? "not_applicable" });
    }
  }

  // The app message and its external-delivery intent commit together.  Missing
  // SendGrid configuration is recorded honestly as not_configured; no caller
  // is told the email was delivered.
  const { message, replayed } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(messagesTable)
      .values({ conversationId: convo.id, senderId: sender.id, body: body.data.body, clientRequestId: body.data.clientRequestId ?? null })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      if (!body.data.clientRequestId) throw new Error("Message insert failed");
      const [existing] = await tx.select().from(messagesTable).where(and(eq(messagesTable.senderId, sender.id), eq(messagesTable.clientRequestId, body.data.clientRequestId)));
      if (!existing || existing.conversationId !== convo.id) throw new Error("clientRequestId conflict");
      return { message: existing, replayed: true };
    }
    if (
      !convo.isGroup &&
      isInspectorManager(sender.role)
    ) {
      const otherId = shared?.id ?? (convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!);
      const [inspector] = await tx.select().from(staffTable).where(eq(staffTable.id, otherId));
      if (
        inspector?.role === "inspector" &&
        inspector.active &&
        inspector.loginEnabled &&
        normalizedEmail(inspector.email) === INSPECTOR_EMAIL
      ) {
        await tx.insert(messageEmailOutboxTable).values({
          messageId: created.id, conversationId: convo.id, inspectorId: inspector.id,
          supervisorId: sender.id, inspectorEmail: inspector.email!, inspectorName: inspector.name,
          supervisorName: sender.name, messageBody: body.data.body, status: outboundEmailStatus(),
        });
      }
    }
    return { message: created, replayed: false };
  });

  const preview =
    body.data.body.length > 120 ? `${body.data.body.slice(0, 117)}...` : body.data.body;

  // Notify only for the winning insert; concurrent idempotent retries must not
  // duplicate notifications.
  if (!replayed && shared) {
    const recipients = [...new Set([shared.id, ...(await inspectorManagers()).map(manager => manager.id)])].filter(id => id !== sender.id);
    if (recipients.length) await db.insert(notificationsTable).values(recipients.map(id => ({ staffId: id, type: "new_message" as const, message: "Inspector messages — " + sender.name + ": " + preview })));
  } else if (!replayed && convo.isGroup) {
    const parts = await db
      .select({ staffId: conversationParticipantsTable.staffId })
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, convo.id));
    const others = parts.filter((p) => p.staffId !== sender.id);
    if (others.length > 0) {
      await db.insert(notificationsTable).values(
        others.map((p) => ({
          staffId: p.staffId,
          type: "new_message" as const,
          message: `💬 ${sender.name}: ${preview}`,
        }))
      );
    }
  } else if (!replayed) {
    const recipientId =
      convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!;
    await db.insert(notificationsTable).values({
      staffId: recipientId,
      type: "new_message" as const,
      message: `💬 New message from ${sender.name}: ${preview}`,
    });
  }

  const [outbox] = await db.select({ status: messageEmailOutboxTable.status })
    .from(messageEmailOutboxTable).where(eq(messageEmailOutboxTable.messageId, message.id));
  return res.status(replayed ? 200 : 201).json({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: sender.name,
    body: message.body,
    isRead: message.isRead,
    inspectorWorkflowTaskId: null,
    // Status represents the durable provider-delivery intent only. "accepted"
    // (when a worker later records it) is not a claim that the recipient read
    // the message.
    inspectorEmailDeliveryStatus: outbox?.status ?? "not_applicable",
    createdAt: message.createdAt.toISOString(),
  });
});

router.patch("/conversations/:id/messages/:msgId", async (req: Request, res: Response) => {
  const params = MessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = MessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Message must be between 1 and 2000 characters" });
    return;
  }
  const actor = await requireActor(req, res, body.data.senderId);
  if (!actor) return;

  const result = await loadConversationForParticipant(params.data.id, actor.id);
  if (result.status !== undefined) {
    sendConvoError(res, result.status);
    return;
  }

  const [existing] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, params.data.msgId));
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (existing.conversationId !== params.data.id) {
    res.status(403).json({ error: "Message not in this conversation" });
    return;
  }
  if (existing.senderId !== actor.id) {
    res.status(403).json({ error: "You can only edit your own messages" });
    return;
  }

  const [updated] = await db
    .update(messagesTable)
    .set({ body: body.data.body })
    .where(
      and(
        eq(messagesTable.id, existing.id),
        eq(messagesTable.conversationId, params.data.id),
        eq(messagesTable.senderId, actor.id)
      )
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  res.json({
    id: updated.id,
    conversationId: updated.conversationId,
    senderId: updated.senderId,
    senderName: actor.name,
    body: updated.body,
    isRead: updated.isRead,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/conversations/:id/messages/:msgId", async (req: Request, res: Response) => {
  const params = MessageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) { res.status(400).json({ error: "staffId is required" }); return; }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Only administrators can delete messages" });
    return;
  }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, params.data.msgId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  if (msg.conversationId !== params.data.id) { res.status(403).json({ error: "Message not in this conversation" }); return; }

  await db
    .delete(messagesTable)
    .where(
      and(
        eq(messagesTable.id, params.data.msgId),
        eq(messagesTable.conversationId, params.data.id),
      ),
    );
  res.json({ deleted: true });
});

router.post("/conversations/:id/read", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = ReadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const actor = await requireActor(req, res, body.data.staffId);
  if (!actor) return;
  const result = await loadConversationForParticipant(params.data.id, actor.id);
  if (result.status !== undefined) {
    sendConvoError(res, result.status);
    return;
  }

  if (await inspectorForConversation(result.convo)) {
    await db.insert(conversationParticipantsTable).values({ conversationId: params.data.id, staffId: actor.id, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [conversationParticipantsTable.conversationId, conversationParticipantsTable.staffId], set: { lastReadAt: new Date() } });
    res.json({ updated: 1 });
  } else if (result.convo.isGroup) {
    // Update last_read_at for this participant
    await db
      .update(conversationParticipantsTable)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, params.data.id),
          eq(conversationParticipantsTable.staffId, actor.id)
        )
      );
    res.json({ updated: 1 });
  } else {
    const updated = await db
      .update(messagesTable)
      .set({ isRead: true })
      .where(
        and(
          eq(messagesTable.conversationId, params.data.id),
          eq(messagesTable.isRead, false),
          ne(messagesTable.senderId, actor.id)
        )
      )
      .returning({ id: messagesTable.id });
    res.json({ updated: updated.length });
  }
});

router.patch("/conversations/:id/archive", async (req: Request, res: Response) => {
  const params = IdParams.safeParse(req.params);
  const body = z.object({ staffId: z.coerce.number(), archived: z.boolean() }).safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const actor = await requireActor(req, res, body.data.staffId);
  if (!actor) return;
  const access = await loadConversationForParticipant(params.data.id, actor.id);
  if (access.status !== undefined) { sendConvoError(res, access.status); return; }
  if (body.data.archived) {
    await db.insert(conversationArchivesTable).values({ conversationId: params.data.id, staffId: actor.id })
      .onConflictDoNothing();
  } else {
    await db.delete(conversationArchivesTable).where(and(
      eq(conversationArchivesTable.conversationId, params.data.id),
      eq(conversationArchivesTable.staffId, actor.id),
    ));
  }
  res.json({ archived: body.data.archived });
});

export default router;
