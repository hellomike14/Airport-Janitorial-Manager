import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  staffTable,
  notificationsTable,
  conversationParticipantsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, ne, count, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { actorIdFromRequest } from "../lib/actorSession";

const router: IRouter = Router();

const StaffIdQuery = z.object({ staffId: z.coerce.number() });
const IdParams = z.object({ id: z.coerce.number() });
const StartBody = z.object({ staffId: z.number(), recipientId: z.number() });
const GroupStartBody = z.object({
  staffId: z.number(),
  recipientIds: z.array(z.number()).min(1).max(50),
  groupName: z.string().max(100).optional(),
});
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
 * match the authenticated actor, otherwise the request is rejected.
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

// ── 1-on-1 pair rules ─────────────────────────────────────────────────────────

// Allowed 1:1 pairs:
//   staff      ↔ admin or supervisor
//   admin      ↔ supervisor
//   supervisor ↔ inspector
function isAllowedPair(a: StaffRow, b: StaffRow): boolean {
  const isMgr = (s: StaffRow) => s.role === "admin" || s.role === "supervisor";
  if (a.role === "staff" && isMgr(b)) return true;
  if (b.role === "staff" && isMgr(a)) return true;
  if (isMgr(a) && isMgr(b)) return true;
  if (
    (a.role === "supervisor" && b.role === "inspector") ||
    (a.role === "inspector" && b.role === "supervisor")
  )
    return true;
  return false;
}

// Who can start a 1:1 conversation:
//   admin      → staff, supervisor
//   supervisor → staff, admin, inspector
//   inspector  → supervisor
//   staff      → supervisor
function canStart(sender: StaffRow, recipient: StaffRow): boolean {
  const isMgr = (s: StaffRow) => s.role === "admin" || s.role === "supervisor";
  if (sender.role === "admin") return recipient.role === "staff" || recipient.role === "supervisor";
  if (sender.role === "supervisor") return recipient.role === "staff" || isMgr(recipient) || recipient.role === "inspector";
  if (sender.role === "inspector") return recipient.role === "supervisor";
  if (sender.role === "staff") return recipient.role === "supervisor";
  return false;
}

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

  // 1:1
  const otherId =
    convo.participantAId === viewerId ? convo.participantBId! : convo.participantAId!;
  const other = await getStaff(otherId);
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
    if (convo.participantAId !== staffId && convo.participantBId !== staffId)
      return { status: 403 };
  }
  return { convo };
}

function sendConvoError(res: Response, status: 404 | 403) {
  res.status(status).json({ error: status === 404 ? "Conversation not found" : "Not a participant" });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/conversations", async (req: Request, res: Response) => {
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId });
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
      .where(inArray(conversationsTable.id, groupIds));
  }

  const convos = [...oneToOne, ...groupConvos];
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

  // Validate sender is still allowed to send (1:1 only; group membership was
  // validated at creation time so no further pair-check is needed).
  if (!convo.isGroup) {
    const recipientId =
      convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!;
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

  const [message] = await db
    .insert(messagesTable)
    .values({ conversationId: convo.id, senderId: sender.id, body: body.data.body })
    .returning();

  const preview =
    body.data.body.length > 120 ? `${body.data.body.slice(0, 117)}...` : body.data.body;

  // Notify all other participants
  if (convo.isGroup) {
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
  } else {
    const recipientId =
      convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!;
    await db.insert(notificationsTable).values({
      staffId: recipientId,
      type: "new_message" as const,
      message: `💬 New message from ${sender.name}: ${preview}`,
    });
  }

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

router.delete("/conversations/:id/messages/:msgId", async (req: Request, res: Response) => {
  const params = z.object({ id: z.coerce.number(), msgId: z.coerce.number() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const query = StaffIdQuery.safeParse({ staffId: req.query.staffId });
  if (!query.success) { res.status(400).json({ error: "staffId is required" }); return; }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, params.data.msgId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  if (msg.senderId !== actor.id) { res.status(403).json({ error: "You can only delete your own messages" }); return; }
  if (msg.conversationId !== params.data.id) { res.status(403).json({ error: "Message not in this conversation" }); return; }

  await db.delete(messagesTable).where(eq(messagesTable.id, params.data.msgId));
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

  if (result.convo.isGroup) {
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

export default router;
