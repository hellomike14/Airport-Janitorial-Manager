import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  staffTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, ne, count } from "drizzle-orm";
import { z } from "zod";
import { actorIdFromRequest } from "../lib/actorSession";

const router: IRouter = Router();

const StaffIdQuery = z.object({ staffId: z.coerce.number() });
const IdParams = z.object({ id: z.coerce.number() });
const StartBody = z.object({ staffId: z.number(), recipientId: z.number() });
const SendBody = z.object({ senderId: z.number(), body: z.string().min(1).max(2000) });
const ReadBody = z.object({ staffId: z.coerce.number() });

type StaffRow = typeof staffTable.$inferSelect;
type ConversationRow = typeof conversationsTable.$inferSelect;

async function getStaff(id: number): Promise<StaffRow | undefined> {
  const [row] = await db.select().from(staffTable).where(eq(staffTable.id, id));
  return row;
}

/**
 * Resolves the authenticated actor for messaging endpoints. The caller's
 * identity comes ONLY from the signed actor-session cookie — client-supplied
 * staffId/senderId values are accepted for API-shape compatibility but must
 * match the authenticated actor, otherwise the request is rejected. This
 * prevents reading or sending messages as another staff member.
 */
async function requireActor(req: Request, res: Response, claimedId: number): Promise<StaffRow | null> {
  const actorId = actorIdFromRequest(req);
  if (actorId === null) {
    res.status(401).json({ error: "Login session required" });
    return null;
  }
  if (actorId !== claimedId) {
    res.status(403).json({ error: "You can only act as yourself" });
    return null;
  }
  const actor = await getStaff(actorId);
  if (!actor || !actor.active) {
    res.status(401).json({ error: "Login session required" });
    return null;
  }
  return actor;
}

// Messaging is allowed between:
//   - staff ↔ admin or supervisor
//   - admin ↔ supervisor (and vice-versa)
function isAllowedPair(a: StaffRow, b: StaffRow): boolean {
  const isMgr = (s: StaffRow) => s.role === "admin" || s.role === "supervisor";
  if (a.role === "staff" && isMgr(b)) return true;
  if (b.role === "staff" && isMgr(a)) return true;
  if (isMgr(a) && isMgr(b)) return true;
  return false;
}

// Starting rules:
//   admin/supervisor → staff or the other manager role
//   staff            → supervisor only
function canStart(sender: StaffRow, recipient: StaffRow): boolean {
  const isMgr = (s: StaffRow) => s.role === "admin" || s.role === "supervisor";
  if (isMgr(sender)) {
    return recipient.role === "staff" || isMgr(recipient);
  }
  if (sender.role === "staff") {
    return recipient.role === "supervisor";
  }
  return false;
}

async function buildSummary(convo: ConversationRow, viewerId: number) {
  const otherId = convo.participantAId === viewerId ? convo.participantBId : convo.participantAId;
  const other = await getStaff(otherId);
  const [last] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convo.id))
    .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id))
    .limit(1);
  const [{ value: unread }] = await db
    .select({ value: count() })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, convo.id),
        eq(messagesTable.isRead, false),
        ne(messagesTable.senderId, viewerId)
      )
    );
  return {
    id: convo.id,
    otherStaffId: otherId,
    otherStaffName: other?.name ?? "Unknown",
    otherStaffRole: other?.role ?? "staff",
    lastMessage: last?.body ?? null,
    lastMessageAt: last ? last.createdAt.toISOString() : null,
    unreadCount: unread,
    createdAt: convo.createdAt.toISOString(),
  };
}

async function loadConversationForParticipant(
  id: number,
  staffId: number
): Promise<{ status: 404 | 403; convo?: undefined } | { status?: undefined; convo: ConversationRow }> {
  const [convo] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!convo) return { status: 404 };
  if (convo.participantAId !== staffId && convo.participantBId !== staffId) {
    return { status: 403 };
  }
  return { convo };
}

function sendConvoError(res: Response, status: 404 | 403) {
  res.status(status).json({ error: status === 404 ? "Conversation not found" : "Not a participant" });
}

router.get("/conversations", async (req: Request, res: Response) => {
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;
  const staffId = actor.id;
  const convos = await db
    .select()
    .from(conversationsTable)
    .where(
      or(
        eq(conversationsTable.participantAId, staffId),
        eq(conversationsTable.participantBId, staffId)
      )
    );
  const summaries = await Promise.all(convos.map((c) => buildSummary(c, staffId)));
  summaries.sort((a, b) => {
    const ta = a.lastMessageAt ?? a.createdAt;
    const tb = b.lastMessageAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });
  res.json(summaries);
});

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
  const [aId, bId] = sender.id < recipientId ? [sender.id, recipientId] : [recipientId, sender.id];
  // Conflict-safe get-or-create: the unique constraint on the participant
  // pair guarantees one thread per pair even under concurrent requests.
  const [inserted] = await db
    .insert(conversationsTable)
    .values({ participantAId: aId, participantBId: bId })
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
  res.json(rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = SendBody.safeParse(req.body);
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
  const recipientId =
    convo.participantAId === sender.id ? convo.participantBId : convo.participantAId;
  const recipient = await getStaff(recipientId);
  if (!recipient) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (!isAllowedPair(sender, recipient)) {
    res.status(403).json({ error: "You are not allowed to message this person" });
    return;
  }
  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId: convo.id,
      senderId: sender.id,
      body: body.data.body,
    })
    .returning();

  // Alert the recipient through the existing notification bell.
  const preview = body.data.body.length > 120 ? `${body.data.body.slice(0, 117)}...` : body.data.body;
  await db.insert(notificationsTable).values({
    staffId: recipientId,
    type: "new_message",
    message: `💬 New message from ${sender.name}: ${preview}`,
  });

  res.status(201).json({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: sender.name,
    body: message.body,
    isRead: message.isRead,
    createdAt: message.createdAt.toISOString(),
  });
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
});

export default router;
