import { sharedInspector, canReadSharedInspector, sharedMessageIsRead, groupSharedInspectorThreads, canonicalSharedInspectorThread, sharedInspectorGroupIsArchived } from "../lib/sharedInspectorConversation";
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
  messageReceiptAcknowledgementsTable,
  conversationArchivesTable,
  inspectorTaskLinksTable,
  inspectorTaskAssignmentHistoryTable,
  tasksTable,
  areasTable,
  objectUploadsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, ne, count, gt, inArray, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { INSPECTOR_EMAIL, INSPECTOR_RECIPIENT_EMAILS, aggregateInspectorEmailStatus, classifyInboundInspectorEmailTarget, groupInspectorEmailRecipients, normalizedEmail, outboundEmailStatus, resolveInspectorRecipients, isAuthorizedInspectorEmailSender, verifyInboundWebhookSecret, verifyReplyToken, inboundProviderMessageId } from "../lib/sendgridEmailBridge";
import { autoAssignInboundInspectorMessage } from "../lib/inspectorTaskWorkflow";
import { groupInboundEmailReceivedAt, groupInspectorEmailAcceptedAt } from "../lib/messageEmailHistory";
import {
  buildMessageReceiptView,
  canConfirmMessageReceipt,
  getMessageReceiptDirection,
  hashMessageBody,
  type MessageReceiptFacts,
} from "../lib/messageReceipt";

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
  beforeImagePath: z.string().optional(),
  afterImagePath: z.string().optional(),
  clientRequestId: z.string().uuid().optional(),
  inspectorRecipients: z.array(z.string()).min(1).max(INSPECTOR_RECIPIENT_EMAILS.length).optional(),
});
const EditMessageBody = MessageBody.omit({ inspectorRecipients: true, beforeImagePath: true, afterImagePath: true });
const ReadBody = z.object({ staffId: z.coerce.number() });
const MessageParams = z.object({ id: z.coerce.number(), msgId: z.coerce.number() });
const InspectorWorkflowParams = z.object({ taskId: z.coerce.number().int().positive() });
const InboundReplyBody = z.object({
  envelope: z.object({ from: z.string(), to: z.array(z.string()).min(1) }),
  from: z.string(), text: z.string().trim().min(1).max(60000),
  subject: z.string().max(1000).optional(),
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

async function sharedInspectorThreads(inspectorId: number): Promise<ConversationRow[]> {
  const candidates = await db.select().from(conversationsTable).where(and(
    eq(conversationsTable.isGroup, false),
    or(eq(conversationsTable.participantAId, inspectorId), eq(conversationsTable.participantBId, inspectorId)),
  ));
  if (!candidates.length) return [];
  const participantIds = [...new Set(candidates.flatMap((conversation) => [
    conversation.participantAId, conversation.participantBId,
  ]).filter((id): id is number => id !== null))];
  const people = await db.select({
    id: staffTable.id,
    role: staffTable.role,
    email: staffTable.email,
  }).from(staffTable).where(inArray(staffTable.id, participantIds));
  return groupSharedInspectorThreads(candidates, people).get(inspectorId) ?? [];
}

async function directInboundInspectorThread() {
  return db.transaction(async (tx) => {
    // Lock active inspector rows so concurrent direct inbound deliveries make
    // one canonical-thread decision at a time.
    const activeInspectors = await tx.select().from(staffTable).where(and(
      eq(staffTable.role, "inspector"),
      eq(staffTable.active, true),
    )).orderBy(asc(staffTable.id)).for("update");
    const matchingInspectors = activeInspectors.filter((person) => normalizedEmail(person.email) === INSPECTOR_EMAIL);
    const managers = await tx.select().from(staffTable).where(and(
      inArray(staffTable.role, ["admin", "supervisor"]),
      eq(staffTable.active, true),
      eq(staffTable.loginEnabled, true),
      eq(staffTable.formerEmployee, false),
    )).orderBy(asc(staffTable.id)).for("update");
    if (matchingInspectors.length !== 1 || !matchingInspectors[0]!.loginEnabled ||
        matchingInspectors[0]!.formerEmployee || managers.length === 0) return null;

    const inspector = matchingInspectors[0]!;
    const candidates = await tx.select().from(conversationsTable).where(and(
      eq(conversationsTable.isGroup, false),
      or(eq(conversationsTable.participantAId, inspector.id), eq(conversationsTable.participantBId, inspector.id)),
    )).orderBy(asc(conversationsTable.id));
    const people = await tx.select().from(staffTable);
    const activeManagers = new Map(managers.map((manager) => [manager.id, manager]));
    let conversation = candidates.find((candidate) => {
      const otherId = candidate.participantAId === inspector.id ? candidate.participantBId : candidate.participantAId;
      return otherId != null && activeManagers.has(otherId) &&
        sharedInspector(candidate, people)?.id === inspector.id;
    });
    let supervisor = conversation
      ? activeManagers.get(conversation.participantAId === inspector.id ? conversation.participantBId! : conversation.participantAId!)!
      : managers[0]!;
    if (!conversation) {
      const [participantAId, participantBId] = [inspector.id, supervisor.id].sort((left, right) => left - right);
      const [created] = await tx.insert(conversationsTable).values({ participantAId, participantBId })
        .onConflictDoNothing({ target: [conversationsTable.participantAId, conversationsTable.participantBId] })
        .returning();
      conversation = created ?? (await tx.select().from(conversationsTable).where(and(
        eq(conversationsTable.participantAId, participantAId),
        eq(conversationsTable.participantBId, participantBId),
      )).then((rows) => rows[0]));
    }
    return conversation ? { inspector, supervisor, conversation } : null;
  });
}

async function inspectorManagers() {
  return db.select({ id: staffTable.id }).from(staffTable).where(and(
    inArray(staffTable.role, ["admin", "supervisor"]), eq(staffTable.active, true),
    eq(staffTable.loginEnabled, true), eq(staffTable.formerEmployee, false)));
}

router.get("/inspector-email/recipients", async (req: Request, res: Response) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  if (!isInspectorManager(actor.role)) return res.status(403).json({ error: "Supervisor access required" });
  const eligibleInspectors = await db.select({ id: staffTable.id, email: staffTable.email }).from(staffTable).where(and(
    eq(staffTable.role, "inspector"),
    eq(staffTable.active, true),
    eq(staffTable.loginEnabled, true),
    eq(staffTable.formerEmployee, false),
  ));
  const dedicatedInspectors = eligibleInspectors.filter((person) => normalizedEmail(person.email) === INSPECTOR_EMAIL);
  if (dedicatedInspectors.length !== 1) return res.status(503).json({ error: "Shared inspector identity is not configured uniquely" });
  return res.json({ inspectorId: dedicatedInspectors[0]!.id, emails: [...INSPECTOR_RECIPIENT_EMAILS] });
});

// ── 1-on-1 pair rules ─────────────────────────────────────────────────────────

// Allowed 1:1 pairs:
//   staff      ↔ admin or supervisor
//   admin      ↔ supervisor
//   supervisor ↔ inspector
// ── Summary builder ───────────────────────────────────────────────────────────

async function buildSummary(convo: ConversationRow, viewerId: number, sharedThreadIds?: number[]) {
  const messageConversationIds = sharedThreadIds?.length ? sharedThreadIds : [convo.id];
  const [last] = await db
    .select()
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, messageConversationIds))
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
      conversationIds: [convo.id],
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
  const other = await getStaff(otherId);
  let unread: number;
  if (inspector) {
    const positions = await db.select({
      conversationId: conversationParticipantsTable.conversationId,
      lastReadAt: conversationParticipantsTable.lastReadAt,
    }).from(conversationParticipantsTable).where(and(
      inArray(conversationParticipantsTable.conversationId, messageConversationIds),
      eq(conversationParticipantsTable.staffId, viewerId),
    ));
    const lastReadByConversationId = new Map(positions.map((position) => [position.conversationId, position.lastReadAt]));
    const unreadMessages = await db.select({
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      createdAt: messagesTable.createdAt,
    }).from(messagesTable).where(and(
      inArray(messagesTable.conversationId, messageConversationIds),
      ne(messagesTable.senderId, viewerId),
    ));
    unread = unreadMessages.filter((message) => {
      const lastReadAt = lastReadByConversationId.get(message.conversationId);
      return !lastReadAt || message.createdAt > lastReadAt;
    }).length;
  } else {
    const [{ value }] = await db.select({ value: count() }).from(messagesTable).where(and(
      eq(messagesTable.conversationId, convo.id),
      eq(messagesTable.isRead, false),
      ne(messagesTable.senderId, viewerId),
    ));
    unread = value;
  }
  return {
    id: convo.id,
    conversationIds: sharedThreadIds?.length ? sharedThreadIds : [convo.id],
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
  const target = classifyInboundInspectorEmailTarget(body.data.envelope.to, domain);
  if (target.kind === "invalid") {
    res.status(403).json({ error: "Inbound recipient is not authorized" });
    return;
  }
  const inboundSenderEmail = isAuthorizedInspectorEmailSender(body.data.from, body.data.envelope.from, body.data.SPF, body.data.dkim);
  if (!inboundSenderEmail) {
    res.status(403).json({ error: "Inbound sender is not authorized" });
    return;
  }

  let inspector: StaffRow;
  let supervisor: StaffRow;
  let conversation: ConversationRow;
  if (target.kind === "reply") {
    const claims = verifyReplyToken(target.token, process.env.SENDGRID_REPLY_TOKEN_SECRET);
    if (!claims) {
      res.status(403).json({ error: "Invalid or expired reply address" });
      return;
    }
    const [replyInspector, replySupervisor, replyConversation] = await Promise.all([
      getStaff(claims.inspectorId),
      getStaff(claims.supervisorId),
      db.select().from(conversationsTable).where(eq(conversationsTable.id, claims.conversationId)).then((rows) => rows[0]),
    ]);
    if (!replyInspector || !replySupervisor || !replyConversation || replyConversation.isGroup ||
        replyInspector.role !== "inspector" || !isInspectorManager(replySupervisor.role) ||
        !replyInspector.active || !replyInspector.loginEnabled || replyInspector.formerEmployee ||
        !replySupervisor.active || !replySupervisor.loginEnabled || replySupervisor.formerEmployee ||
        normalizedEmail(replyInspector.email) !== INSPECTOR_EMAIL) {
      res.status(403).json({ error: "Inbound sender is not authorized" });
      return;
    }
    if (!new Set([replyConversation.participantAId, replyConversation.participantBId]).has(replyInspector.id) ||
        !(await inspectorForConversation(replyConversation))) {
      res.status(403).json({ error: "Conversation is not authorized" });
      return;
    }
    inspector = replyInspector;
    supervisor = replySupervisor;
    conversation = replyConversation;
  } else {
    const directThread = await directInboundInspectorThread();
    if (!directThread) {
      res.status(503).json({ error: "Active shared inspector identity or manager is unavailable" });
      return;
    }
    inspector = directThread.inspector;
    supervisor = directThread.supervisor;
    conversation = directThread.conversation;
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
    const [message] = await tx.insert(messagesTable).values({
      conversationId: conversation.id,
      senderId: inspector.id,
      body: `From inspector: ${inboundSenderEmail}\n${body.data.subject ? `Subject: ${body.data.subject}\n` : ""}\n${body.data.text}`,
    }).returning();
    await tx.update(inboundEmailMessagesTable).set({ messageId: message.id }).where(eq(inboundEmailMessagesTable.providerMessageId, providerMessageId));
    // A fresh inspector email must be visible even if a manager archived the thread.
    await tx.delete(conversationArchivesTable).where(eq(conversationArchivesTable.conversationId, conversation.id));
    const managers = await tx.select({ id: staffTable.id }).from(staffTable).where(and(
      inArray(staffTable.role, ["admin", "supervisor"]),
      eq(staffTable.active, true),
      eq(staffTable.loginEnabled, true),
      eq(staffTable.formerEmployee, false),
    ));
    if (managers.length) await tx.insert(notificationsTable).values(managers.map(manager => ({ staffId: manager.id, type: "inspector_to_supervisor" as const, message: "URGENT: Inspector email message received", isRead: false })));
    const managerIds = new Set(managers.map(manager => manager.id));
    const staff = await tx.select({ id: staffTable.id }).from(staffTable).where(and(
      eq(staffTable.active, true), eq(staffTable.loginEnabled, true), ne(staffTable.id, inspector.id),
    ));
    const otherStaff = staff.filter(person => !managerIds.has(person.id));
    if (otherStaff.length) await tx.insert(notificationsTable).values(otherStaff.map(person => ({
      staffId: person.id, type: "new_message" as const, message: "New message in Marvol",
    })));
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
  const completionOutbox = row.completionMessageId
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
    completionEmailDeliveryStatus: aggregateInspectorEmailStatus(completionOutbox.map(({ status }) => status)) ?? null,
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

  const sharedPeople = await db.select({
    id: staffTable.id,
    role: staffTable.role,
    email: staffTable.email,
    active: staffTable.active,
    loginEnabled: staffTable.loginEnabled,
    formerEmployee: staffTable.formerEmployee,
  }).from(staffTable);
  if (isInspectorManager(actor.role)) {
    const inspectorIds = sharedPeople.filter(p => p.role === "inspector" && normalizedEmail(p.email) === INSPECTOR_EMAIL).map(p => p.id);
    if (inspectorIds.length) {
      const candidates = await db.select().from(conversationsTable).where(and(eq(conversationsTable.isGroup, false), or(
        inArray(conversationsTable.participantAId, inspectorIds), inArray(conversationsTable.participantBId, inspectorIds))));
      for (const convo of candidates) {
        if (canReadSharedInspector(actor, convo, sharedPeople) && !oneToOne.some(c => c.id === convo.id)) oneToOne.push(convo);
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
  const conversations = [...oneToOne, ...groupConvos];
  const sharedGroups = groupSharedInspectorThreads(conversations, sharedPeople);
  const groupedConversationIds = new Set([...sharedGroups.values()].flat().map((conversation) => conversation.id));
  const summaries = await Promise.all(conversations
    .filter((conversation) => !groupedConversationIds.has(conversation.id) && archivedIds.has(conversation.id) === showArchived)
    .map((conversation) => buildSummary(conversation, staffId)));
  for (const threads of sharedGroups.values()) {
    const isArchivedForViewer = sharedInspectorGroupIsArchived(threads.map((thread) => thread.id), archivedIds);
    if (isArchivedForViewer !== showArchived) continue;
    const canonical = canonicalSharedInspectorThread(threads, sharedPeople);
    if (!canonical) continue;
    summaries.push(await buildSummary(canonical, staffId, threads.map((thread) => thread.id)));
  }
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
    const canonical = await directInboundInspectorThread();
    if (!canonical) {
      res.status(503).json({ error: "Active shared inspector identity or manager is unavailable" });
      return;
    }
    res.json(await buildSummary(canonical.conversation, sender.id));
    return;
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
  const historyThreads = shared ? await sharedInspectorThreads(shared.id) : [result.convo];
  const historyThreadIds = historyThreads.length ? historyThreads.map((thread) => thread.id) : [result.convo.id];
  const readPositions = shared
    ? await db.select({
        conversationId: conversationParticipantsTable.conversationId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
      }).from(conversationParticipantsTable).where(and(
        inArray(conversationParticipantsTable.conversationId, historyThreadIds),
        eq(conversationParticipantsTable.staffId, actor.id),
      ))
    : [];
  const lastReadByConversationId = new Map(readPositions.map((position) => [position.conversationId, position.lastReadAt]));
  const rows = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      senderName: staffTable.name,
      senderRole: staffTable.role,
      body: messagesTable.body,
      beforeImagePath: messagesTable.beforeImagePath,
      afterImagePath: messagesTable.afterImagePath,
      isRead: messagesTable.isRead,
      receiptVersion: messagesTable.receiptVersion,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(staffTable, eq(messagesTable.senderId, staffTable.id))
    .where(inArray(messagesTable.conversationId, historyThreadIds))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));
  const [workflowLinks, outboxRows, inboundRows, receiptRows] = await Promise.all([
    db.select({
      taskId: inspectorTaskLinksTable.taskId,
      sourceMessageId: inspectorTaskLinksTable.sourceMessageId,
      completionMessageId: inspectorTaskLinksTable.completionMessageId,
    }).from(inspectorTaskLinksTable).where(inArray(inspectorTaskLinksTable.conversationId, historyThreadIds)),
    db.select({
      messageId: messageEmailOutboxTable.messageId,
      inspectorEmail: messageEmailOutboxTable.inspectorEmail,
      status: messageEmailOutboxTable.status,
      acceptedAt: messageEmailOutboxTable.acceptedAt,
    }).from(messageEmailOutboxTable)
      .where(inArray(messageEmailOutboxTable.conversationId, historyThreadIds))
      .orderBy(asc(messageEmailOutboxTable.id)),
    db.select({
      messageId: inboundEmailMessagesTable.messageId,
      receivedAt: inboundEmailMessagesTable.receivedAt,
    }).from(inboundEmailMessagesTable).where(inArray(inboundEmailMessagesTable.conversationId, historyThreadIds)),
    db.select({
      messageId: messageReceiptAcknowledgementsTable.messageId,
      messageVersion: messageReceiptAcknowledgementsTable.messageVersion,
      bodySha256: messageReceiptAcknowledgementsTable.bodySha256,
      confirmedByName: messageReceiptAcknowledgementsTable.confirmedByName,
      confirmedByRole: messageReceiptAcknowledgementsTable.confirmedByRole,
      confirmedAt: messageReceiptAcknowledgementsTable.confirmedAt,
    }).from(messageReceiptAcknowledgementsTable)
      .where(inArray(messageReceiptAcknowledgementsTable.conversationId, historyThreadIds))
      .orderBy(asc(messageReceiptAcknowledgementsTable.messageVersion)),
  ]);
  const workflowTaskByMessageId = new Map<number, number>();
  workflowLinks.forEach((link) => {
    workflowTaskByMessageId.set(link.sourceMessageId, link.taskId);
    if (link.completionMessageId) workflowTaskByMessageId.set(link.completionMessageId, link.taskId);
  });
  const linkedTaskIds = [...new Set(workflowLinks.map((link) => link.taskId))];
  const workflowTaskPhotos = linkedTaskIds.length
    ? await db.select({
        id: tasksTable.id,
        beforeImagePath: tasksTable.beforeImagePath,
        afterImagePath: tasksTable.afterImagePath,
      }).from(tasksTable).where(inArray(tasksTable.id, linkedTaskIds))
    : [];
  const workflowTaskPhotosById = new Map(workflowTaskPhotos.map((task) => [task.id, task]));
  const statusesByMessageId = new Map<number, string[]>();
  const receiptEventsByMessageId = new Map<number, typeof receiptRows>();
  const inspectorEmailRecipientsByMessageId = groupInspectorEmailRecipients(outboxRows);
  const inspectorEmailAcceptedAtByMessageId = groupInspectorEmailAcceptedAt(outboxRows);
  const inboundEmailReceivedAtByMessageId = groupInboundEmailReceivedAt(inboundRows);
  for (const row of outboxRows) {
    const statuses = statusesByMessageId.get(row.messageId) ?? [];
    statuses.push(row.status);
    statusesByMessageId.set(row.messageId, statuses);
  }
  for (const row of receiptRows) {
    const events = receiptEventsByMessageId.get(row.messageId) ?? [];
    events.push(row);
    receiptEventsByMessageId.set(row.messageId, events);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(rows.map((row) => {
    const { senderRole, ...m } = row;
    const inspectorWorkflowTaskId = workflowTaskByMessageId.get(m.id) ?? null;
    const taskPhotos = inspectorWorkflowTaskId === null ? undefined : workflowTaskPhotosById.get(inspectorWorkflowTaskId);
    const useWorkflowTaskPhotos = inspectorWorkflowTaskId !== null && !m.beforeImagePath && !m.afterImagePath;
    const receiptFacts: MessageReceiptFacts = {
      messageId: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderRole,
      body: m.body,
      version: m.receiptVersion,
      inspectorId: shared?.id ?? null,
      hasOutboundEmail: statusesByMessageId.has(m.id),
      hasInboundEmail: inboundEmailReceivedAtByMessageId.has(m.id),
    };
    return {
      ...m,
      beforeImagePath: useWorkflowTaskPhotos ? taskPhotos?.beforeImagePath ?? null : m.beforeImagePath,
      afterImagePath: useWorkflowTaskPhotos ? taskPhotos?.afterImagePath ?? null : m.afterImagePath,
      isRead: shared ? sharedMessageIsRead(m, actor.id, lastReadByConversationId.get(m.conversationId) ?? null) : m.isRead,
      createdAt: m.createdAt.toISOString(),
      inspectorWorkflowTaskId,
      inspectorEmailDeliveryStatus: aggregateInspectorEmailStatus(statusesByMessageId.get(m.id) ?? []) ?? "not_applicable",
      inspectorEmailRecipients: inspectorEmailRecipientsByMessageId.get(m.id) ?? [],
      inspectorEmailAcceptedAt: inspectorEmailAcceptedAtByMessageId.get(m.id) ?? null,
      inboundEmailReceivedAt: inboundEmailReceivedAtByMessageId.get(m.id) ?? null,
      receipt: buildMessageReceiptView(receiptFacts, receiptEventsByMessageId.get(m.id) ?? [], actor),
    };
  }));
});

router.post("/conversations/:id/messages/:msgId/receipt", async (req: Request, res: Response): Promise<void> => {
  const params = MessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (!actor.active || !actor.loginEnabled || actor.formerEmployee) {
    res.status(403).json({ error: "Active staff access is required" });
    return;
  }

  const access = await loadConversationForParticipant(params.data.id, actor.id);
  if (access.status !== undefined) {
    sendConvoError(res, access.status);
    return;
  }
  const shared = await inspectorForConversation(access.convo);
  const historyThreads = shared ? await sharedInspectorThreads(shared.id) : [access.convo];
  const historyThreadIds = new Set(
    historyThreads.length ? historyThreads.map((thread) => thread.id) : [access.convo.id],
  );

  const result = await db.transaction(async (tx) => {
    const [message] = await tx.select().from(messagesTable)
      .where(eq(messagesTable.id, params.data.msgId))
      .for("update");
    if (!message) return { kind: "error" as const, status: 404, error: "Message not found" };
    if (!historyThreadIds.has(message.conversationId)) {
      return { kind: "error" as const, status: 403, error: "Message is outside this conversation history" };
    }

    const [author] = await tx.select({ role: staffTable.role }).from(staffTable)
      .where(eq(staffTable.id, message.senderId));
    if (!author) return { kind: "error" as const, status: 404, error: "Message sender not found" };

    const [[outbound], [inbound], [currentActor]] = await Promise.all([
      tx.select({ id: messageEmailOutboxTable.id }).from(messageEmailOutboxTable)
        .where(eq(messageEmailOutboxTable.messageId, message.id)).limit(1),
      tx.select({ messageId: inboundEmailMessagesTable.messageId }).from(inboundEmailMessagesTable)
        .where(eq(inboundEmailMessagesTable.messageId, message.id)).limit(1),
      tx.select({
        id: staffTable.id,
        name: staffTable.name,
        role: staffTable.role,
        active: staffTable.active,
        loginEnabled: staffTable.loginEnabled,
        formerEmployee: staffTable.formerEmployee,
      }).from(staffTable).where(eq(staffTable.id, actor.id)).limit(1),
    ]);
    if (!currentActor || !currentActor.active || !currentActor.loginEnabled || currentActor.formerEmployee) {
      return { kind: "error" as const, status: 403, error: "Active staff access is required" };
    }

    const facts: MessageReceiptFacts = {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: author.role,
      body: message.body,
      version: message.receiptVersion,
      inspectorId: shared?.id ?? null,
      hasOutboundEmail: Boolean(outbound),
      hasInboundEmail: Boolean(inbound),
    };
    const direction = getMessageReceiptDirection(facts);
    if (!direction) {
      return { kind: "error" as const, status: 409, error: "This message has no inspector email receipt to acknowledge" };
    }
    if (!canConfirmMessageReceipt(currentActor, facts, direction)) {
      return { kind: "error" as const, status: 403, error: "You cannot acknowledge receipt of this message" };
    }

    const receiptEvents = () => tx.select({
      messageVersion: messageReceiptAcknowledgementsTable.messageVersion,
      bodySha256: messageReceiptAcknowledgementsTable.bodySha256,
      confirmedByName: messageReceiptAcknowledgementsTable.confirmedByName,
      confirmedByRole: messageReceiptAcknowledgementsTable.confirmedByRole,
      confirmedAt: messageReceiptAcknowledgementsTable.confirmedAt,
    }).from(messageReceiptAcknowledgementsTable)
      .where(eq(messageReceiptAcknowledgementsTable.messageId, message.id))
      .orderBy(asc(messageReceiptAcknowledgementsTable.messageVersion));

    const priorEvents = await receiptEvents();
    const currentHash = hashMessageBody(message.body);
    const sameVersionEvent = priorEvents.find((event) => event.messageVersion === message.receiptVersion);
    if (sameVersionEvent && sameVersionEvent.bodySha256 !== currentHash) {
      return { kind: "error" as const, status: 409, error: "Receipt evidence for this message version does not match its content" };
    }
    if (sameVersionEvent) {
      return {
        kind: "success" as const,
        alreadyConfirmed: true,
        facts,
        actor: currentActor,
        events: priorEvents,
      };
    }

    const [inserted] = await tx.insert(messageReceiptAcknowledgementsTable).values({
      conversationId: message.conversationId,
      messageId: message.id,
      messageVersion: message.receiptVersion,
      bodySha256: currentHash,
      direction,
      confirmedByStaffId: currentActor.id,
      confirmedByName: currentActor.name,
      confirmedByRole: currentActor.role,
    }).onConflictDoNothing({
      target: [
        messageReceiptAcknowledgementsTable.messageId,
        messageReceiptAcknowledgementsTable.messageVersion,
      ],
    }).returning({
      messageVersion: messageReceiptAcknowledgementsTable.messageVersion,
      bodySha256: messageReceiptAcknowledgementsTable.bodySha256,
      confirmedByName: messageReceiptAcknowledgementsTable.confirmedByName,
      confirmedByRole: messageReceiptAcknowledgementsTable.confirmedByRole,
      confirmedAt: messageReceiptAcknowledgementsTable.confirmedAt,
    });
    const events = inserted ? [...priorEvents, inserted] : await receiptEvents();
    const conflictedEvent = events.find((event) => event.messageVersion === message.receiptVersion);
    if (!conflictedEvent || conflictedEvent.bodySha256 !== currentHash) {
      return { kind: "error" as const, status: 409, error: "Receipt evidence could not be recorded for this message version" };
    }

    return {
      kind: "success" as const,
      alreadyConfirmed: !inserted,
      facts,
      actor: currentActor,
      events,
    };
  });

  if (result.kind === "error") {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.status(result.alreadyConfirmed ? 200 : 201).json({
    messageId: result.facts.messageId,
    alreadyConfirmed: result.alreadyConfirmed,
    receipt: buildMessageReceiptView(result.facts, result.events, result.actor),
  });
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
  if (shared && isInspectorManager(sender.role) && body.data.inspectorRecipients === undefined) {
    return res.status(400).json({ error: "Choose one inspector or explicitly select all inspectors before sending" });
  }
  const selectedInspectorRecipients = body.data.inspectorRecipients === undefined
    ? undefined
    : resolveInspectorRecipients(body.data.inspectorRecipients);
  if (body.data.inspectorRecipients !== undefined && !selectedInspectorRecipients) {
    return res.status(400).json({ error: "Inspector email recipients must be distinct addresses from the approved list" });
  }
  if (body.data.inspectorRecipients !== undefined && (!shared || !isInspectorManager(sender.role))) {
    return res.status(400).json({ error: "Inspector email recipients can only be selected by management in the shared inspector conversation" });
  }

  for (const imagePath of [body.data.beforeImagePath, body.data.afterImagePath]) {
    if (imagePath === undefined) continue;
    const [upload] = await db.select({
      objectPath: objectUploadsTable.objectPath,
      ownerStaffId: objectUploadsTable.ownerStaffId,
      purpose: objectUploadsTable.purpose,
      conversationId: objectUploadsTable.conversationId,
      mimeType: objectUploadsTable.mimeType,
    }).from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, imagePath));
    if (!upload || upload.ownerStaffId !== sender.id || upload.purpose !== "conversation_attachment" ||
        upload.conversationId !== convo.id ||
        !["image/jpeg", "image/png", "image/webp"].includes(upload.mimeType)) {
      return res.status(400).json({ error: "Photo must be an image uploaded by you for this conversation" });
    }
  }

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
      const priorOutbox = await db.select({
        status: messageEmailOutboxTable.status,
        inspectorEmail: messageEmailOutboxTable.inspectorEmail,
        acceptedAt: messageEmailOutboxTable.acceptedAt,
      }).from(messageEmailOutboxTable)
        .where(eq(messageEmailOutboxTable.messageId, prior.id))
        .orderBy(asc(messageEmailOutboxTable.id));
      return res.status(200).json({
        id: prior.id, conversationId: prior.conversationId, senderId: prior.senderId,
        senderName: sender.name, body: prior.body, isRead: prior.isRead,
        receiptVersion: prior.receiptVersion,
        beforeImagePath: prior.beforeImagePath, afterImagePath: prior.afterImagePath,
        createdAt: prior.createdAt.toISOString(), inspectorWorkflowTaskId: null,
        inspectorEmailDeliveryStatus: aggregateInspectorEmailStatus(priorOutbox.map(({ status }) => status)) ?? "not_applicable",
        inspectorEmailRecipients: priorOutbox.map(({ inspectorEmail }) => inspectorEmail),
        inspectorEmailAcceptedAt: groupInspectorEmailAcceptedAt(
          priorOutbox.map((row) => ({ ...row, messageId: prior.id })),
        ).get(prior.id) ?? null,
        inboundEmailReceivedAt: null,
        receipt: buildMessageReceiptView({
          messageId: prior.id,
          conversationId: prior.conversationId,
          senderId: prior.senderId,
          senderRole: sender.role,
          body: prior.body,
          version: prior.receiptVersion,
          inspectorId: shared?.id ?? null,
          hasOutboundEmail: priorOutbox.length > 0,
          hasInboundEmail: false,
        }, [], sender),
      });
    }
  }

  // The app message and its external-delivery intent commit together.  Missing
  // SendGrid configuration is recorded honestly as not_configured; no caller
  // is told the email was delivered.
  const { message, replayed } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(messagesTable)
      .values({
        conversationId: convo.id, senderId: sender.id, body: body.data.body,
        beforeImagePath: body.data.beforeImagePath ?? null,
        afterImagePath: body.data.afterImagePath ?? null,
        clientRequestId: body.data.clientRequestId ?? null,
      })
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
        await tx.insert(messageEmailOutboxTable).values(
          (selectedInspectorRecipients ?? [...INSPECTOR_RECIPIENT_EMAILS]).map((inspectorEmail) => ({
            messageId: created.id, conversationId: convo.id, inspectorId: inspector.id,
            supervisorId: sender.id, inspectorEmail, inspectorName: inspector.name,
            supervisorName: sender.name, messageBody: body.data.body, status: outboundEmailStatus(),
          }))
        );
      }
    }
    return { message: created, replayed: false };
  });

  const preview =
    body.data.body.length > 120 ? `${body.data.body.slice(0, 117)}...` : body.data.body;

  // Notify only for the winning insert; concurrent idempotent retries must not
  // duplicate notifications.
  const notifiedIds = new Set<number>();
  if (!replayed && shared) {
    const recipients = [...new Set([shared.id, ...(await inspectorManagers()).map(manager => manager.id)])].filter(id => id !== sender.id);
    recipients.forEach(id => notifiedIds.add(id));
    if (recipients.length) await db.insert(notificationsTable).values(recipients.map(id => ({ staffId: id, type: "new_message" as const, message: "Inspector messages — " + sender.name + ": " + preview })));
  } else if (!replayed && convo.isGroup) {
    const parts = await db
      .select({ staffId: conversationParticipantsTable.staffId })
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, convo.id));
    const others = parts.filter((p) => p.staffId !== sender.id);
    others.forEach(person => notifiedIds.add(person.staffId));
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
    notifiedIds.add(recipientId);
    await db.insert(notificationsTable).values({
      staffId: recipientId,
      type: "new_message" as const,
      message: `💬 New message from ${sender.name}: ${preview}`,
    });
  }
  if (!replayed) {
    const staff = await db.select({ id: staffTable.id }).from(staffTable).where(and(
      eq(staffTable.active, true), eq(staffTable.loginEnabled, true), ne(staffTable.id, sender.id),
    ));
    const otherStaff = staff.filter(person => !notifiedIds.has(person.id));
    if (otherStaff.length) await db.insert(notificationsTable).values(otherStaff.map(person => ({
      staffId: person.id, type: "new_message" as const, message: "New message in Marvol",
    })));
  }

  const outbox = await db.select({
    status: messageEmailOutboxTable.status,
    inspectorEmail: messageEmailOutboxTable.inspectorEmail,
    acceptedAt: messageEmailOutboxTable.acceptedAt,
  }).from(messageEmailOutboxTable)
    .where(eq(messageEmailOutboxTable.messageId, message.id))
    .orderBy(asc(messageEmailOutboxTable.id));
  return res.status(replayed ? 200 : 201).json({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: sender.name,
    body: message.body,
    isRead: message.isRead,
    receiptVersion: message.receiptVersion,
    beforeImagePath: message.beforeImagePath,
    afterImagePath: message.afterImagePath,
    inspectorWorkflowTaskId: null,
    // Status represents the durable provider-delivery intent only. "accepted"
    // (when a worker later records it) is not a claim that the recipient read
    // the message.
    inspectorEmailDeliveryStatus: aggregateInspectorEmailStatus(outbox.map(({ status }) => status)) ?? "not_applicable",
    inspectorEmailRecipients: outbox.map(({ inspectorEmail }) => inspectorEmail),
    inspectorEmailAcceptedAt: groupInspectorEmailAcceptedAt(outbox.map((row) => ({ ...row, messageId: message.id }))).get(message.id) ?? null,
    inboundEmailReceivedAt: null,
    receipt: buildMessageReceiptView({
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: sender.role,
      body: message.body,
      version: message.receiptVersion,
      inspectorId: shared?.id ?? null,
      hasOutboundEmail: outbox.length > 0,
      hasInboundEmail: false,
    }, [], sender),
    createdAt: message.createdAt.toISOString(),
  });
});

router.patch("/conversations/:id/messages/:msgId", async (req: Request, res: Response) => {
  const params = MessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = EditMessageBody.safeParse(req.body);
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

  const updateResult = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messagesTable)
      .where(eq(messagesTable.id, params.data.msgId))
      .for("update");
    if (!existing) return { kind: "error" as const, error: "Message not found", status: 404 as const };
    if (existing.conversationId !== params.data.id) {
      return { kind: "error" as const, error: "Message not in this conversation", status: 403 as const };
    }
    if (existing.senderId !== actor.id) {
      return { kind: "error" as const, error: "You can only edit your own messages", status: 403 as const };
    }
    if (existing.body === body.data.body) return { kind: "success" as const, updated: existing };

    const [updated] = await tx.update(messagesTable)
      .set({
        body: body.data.body,
        receiptVersion: sql`${messagesTable.receiptVersion} + 1`,
      })
      .where(and(
        eq(messagesTable.id, existing.id),
        eq(messagesTable.conversationId, params.data.id),
        eq(messagesTable.senderId, actor.id),
      ))
      .returning();
    return updated
      ? { kind: "success" as const, updated }
      : { kind: "error" as const, error: "Message not found", status: 404 as const };
  });
  if (updateResult.kind === "error") {
    res.status(updateResult.status).json({ error: updateResult.error });
    return;
  }
  const updated = updateResult.updated;
  const shared = await inspectorForConversation(result.convo);

  const [outboxRows, inboundRows, receiptRows] = await Promise.all([
    db.select({
      messageId: messageEmailOutboxTable.messageId,
      inspectorEmail: messageEmailOutboxTable.inspectorEmail,
      status: messageEmailOutboxTable.status,
      acceptedAt: messageEmailOutboxTable.acceptedAt,
    }).from(messageEmailOutboxTable).where(eq(messageEmailOutboxTable.messageId, updated.id)),
    db.select({
      messageId: inboundEmailMessagesTable.messageId,
      receivedAt: inboundEmailMessagesTable.receivedAt,
    }).from(inboundEmailMessagesTable).where(eq(inboundEmailMessagesTable.messageId, updated.id)),
    db.select({
      messageVersion: messageReceiptAcknowledgementsTable.messageVersion,
      bodySha256: messageReceiptAcknowledgementsTable.bodySha256,
      confirmedByName: messageReceiptAcknowledgementsTable.confirmedByName,
      confirmedByRole: messageReceiptAcknowledgementsTable.confirmedByRole,
      confirmedAt: messageReceiptAcknowledgementsTable.confirmedAt,
    }).from(messageReceiptAcknowledgementsTable)
      .where(eq(messageReceiptAcknowledgementsTable.messageId, updated.id))
      .orderBy(asc(messageReceiptAcknowledgementsTable.messageVersion)),
  ]);
  const receiptFacts: MessageReceiptFacts = {
    messageId: updated.id,
    conversationId: updated.conversationId,
    senderId: updated.senderId,
    senderRole: actor.role,
    body: updated.body,
    version: updated.receiptVersion,
    inspectorId: shared?.id ?? null,
    hasOutboundEmail: outboxRows.length > 0,
    hasInboundEmail: inboundRows.length > 0,
  };
  res.json({
    id: updated.id,
    conversationId: updated.conversationId,
    senderId: updated.senderId,
    senderName: actor.name,
    body: updated.body,
    isRead: updated.isRead,
    receiptVersion: updated.receiptVersion,
    beforeImagePath: updated.beforeImagePath,
    afterImagePath: updated.afterImagePath,
    inspectorWorkflowTaskId: null,
    inspectorEmailDeliveryStatus: aggregateInspectorEmailStatus(outboxRows.map(({ status }) => status)) ?? "not_applicable",
    inspectorEmailRecipients: outboxRows.map(({ inspectorEmail }) => inspectorEmail),
    inspectorEmailAcceptedAt: groupInspectorEmailAcceptedAt(outboxRows).get(updated.id) ?? null,
    inboundEmailReceivedAt: groupInboundEmailReceivedAt(inboundRows).get(updated.id) ?? null,
    receipt: buildMessageReceiptView(receiptFacts, receiptRows, actor),
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/conversations/:id/old-messages", async (req: Request, res: Response) => {
  const params = IdParams.safeParse(req.params);
  const query = z.object({ before: z.string().datetime({ offset: true }) }).safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "A valid conversation and cutoff date are required" });
    return;
  }
  const cutoff = new Date(query.data.before);
  if (Number.isNaN(cutoff.getTime()) || cutoff.getTime() > Date.now()) {
    res.status(400).json({ error: "Cutoff date must not be in the future" });
    return;
  }
  const actor = await actorStaffFromRequest(req);
  if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Only administrators can delete old messages" });
    return;
  }
  const access = await loadConversationForParticipant(params.data.id, actor.id);
  if (access.status !== undefined) { sendConvoError(res, access.status); return; }

  const eligible = and(
    eq(messagesTable.conversationId, params.data.id),
    lt(messagesTable.createdAt, cutoff),
  );
   // Do not erase task provenance, receipt evidence, or cancel an inspector
   // email still awaiting delivery. Those records keep their original messages.
  const unprotected = and(
    notExists(db.select({ taskId: inspectorTaskLinksTable.taskId })
      .from(inspectorTaskLinksTable)
      .where(or(
        eq(inspectorTaskLinksTable.sourceMessageId, messagesTable.id),
        eq(inspectorTaskLinksTable.completionMessageId, messagesTable.id),
      ))),
    notExists(db.select({ id: messageEmailOutboxTable.id })
      .from(messageEmailOutboxTable)
      .where(and(
        eq(messageEmailOutboxTable.messageId, messagesTable.id),
        inArray(messageEmailOutboxTable.status, ["pending", "sending", "retrying", "not_configured"]),
      ))),
    notExists(db.select({ id: messageReceiptAcknowledgementsTable.id })
      .from(messageReceiptAcknowledgementsTable)
      .where(eq(messageReceiptAcknowledgementsTable.messageId, messagesTable.id))),
  );
  const [total] = await db.select({ count: count() }).from(messagesTable).where(eligible);
  const removed = await db.delete(messagesTable)
    .where(and(eligible, unprotected))
    .returning({ id: messagesTable.id });
  res.setHeader("Cache-Control", "no-store");
  res.json({ deleted: removed.length, retained: total.count - removed.length });
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
  const [receipt] = await db.select({ id: messageReceiptAcknowledgementsTable.id })
    .from(messageReceiptAcknowledgementsTable)
    .where(eq(messageReceiptAcknowledgementsTable.messageId, msg.id))
    .limit(1);
  if (receipt) {
    res.status(409).json({ error: "Messages with receipt acknowledgments are retained for audit" });
    return;
  }

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

  const shared = await inspectorForConversation(result.convo);
  if (shared) {
    const historyThreads = await sharedInspectorThreads(shared.id);
    const lastReadAt = new Date();
    await db.insert(conversationParticipantsTable).values(
      (historyThreads.length ? historyThreads : [result.convo]).map((thread) => ({
        conversationId: thread.id, staffId: actor.id, lastReadAt,
      }))
    ).onConflictDoUpdate({
      target: [conversationParticipantsTable.conversationId, conversationParticipantsTable.staffId],
      set: { lastReadAt },
    });
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
  const shared = await inspectorForConversation(access.convo);
  const historyThreads = shared ? await sharedInspectorThreads(shared.id) : [];
  const threadIds = shared && historyThreads.length
    ? historyThreads.map((thread) => thread.id)
    : [params.data.id];
  if (body.data.archived) {
    await db.insert(conversationArchivesTable).values(threadIds.map((conversationId) => ({
      conversationId, staffId: actor.id,
    }))).onConflictDoNothing();
  } else {
    await db.delete(conversationArchivesTable).where(and(
      inArray(conversationArchivesTable.conversationId, threadIds),
      eq(conversationArchivesTable.staffId, actor.id),
    ));
  }
  res.json({ archived: body.data.archived });
});

export default router;
