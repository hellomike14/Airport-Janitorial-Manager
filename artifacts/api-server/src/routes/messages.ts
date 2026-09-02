import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  staffTable,
  notificationsTable,
  conversationParticipantsTable,
  conversationArchivesTable,
  inboundEmailMessagesTable,
  inspectorTaskLinksTable,
  messageEmailOutboxTable,
  tasksTable,
  areasTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, ne, count, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { filterConversationsByArchiveState } from "../lib/conversationArchive";
import {
  extractInboundReplyToken,
  inboundBridgeConfiguration,
  inboundProviderMessageId,
  inboundSenderAuthenticationPasses,
  normalizeEmailAddress,
  outboundBridgeConfiguration,
  sanitizeInboundPlainText,
  verifyInboundWebhookSecret,
  verifyReplyToken,
} from "../lib/sendgridEmailBridge";
import {
  initialEmailDeliveryStatus,
  isExactMessageReplay,
  type PublicEmailDeliveryStatus,
} from "../lib/messageEmailDeliveryPolicy";
import {
  attemptMessageEmailOutboxDelivery,
  wakeMessageEmailOutboxWorker,
} from "../lib/messageEmailOutbox";
import {
  invalidMessageRecipientIds,
  isMessageRecipientEligible,
} from "../lib/messageRecipientPolicy";
import {
  assignInspectorMessageToStaff,
  airportDate,
  autoAssignInspectorMessage,
} from "../lib/inspectorTaskWorkflow";
import { extractInspectorTargetCoordinates } from "../lib/inspectorAssignmentPolicy";

const router: IRouter = Router();
const INSPECTOR_CHANNEL_EMAIL = "inspector@marvolenterprises.com";

const StaffIdQuery = z.object({ staffId: z.coerce.number() });
const ListConversationsQuery = StaffIdQuery.extend({
  archived: z.enum(["true", "false"]).optional(),
});
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
});
const SendMessageBody = MessageBody.extend({
  clientRequestId: z.string().uuid(),
});
const ReadBody = z.object({ staffId: z.coerce.number() });
const InspectorChannelBody = z.object({ staffId: z.coerce.number() });
const ArchiveBody = z.object({
  staffId: z.coerce.number(),
  archived: z.boolean(),
});
const MessageParams = z.object({ id: z.coerce.number(), msgId: z.coerce.number() });
const AssignInspectorMessageBody = z.object({
  staffId: z.coerce.number(),
  areaId: z.coerce.number().int().positive(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const InboundEnvelope = z
  .object({
    from: z.string().max(1_000),
    to: z.array(z.string().max(1_000)).min(1).max(100),
  })
  .passthrough();
const InboundEmailBody = z
  .object({
    envelope: z.string().max(32_000),
    from: z.string().max(1_000),
    text: z.string().max(256_000),
    headers: z.string().max(256_000).optional(),
    subject: z.string().max(2_000).optional(),
    SPF: z.string().max(1_000).optional(),
    spf: z.string().max(1_000).optional(),
    dkim: z.string().max(8_000).optional(),
  })
  .passthrough();

const inboundMultipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fieldSize: 256_000,
    fields: 32,
    files: 5,
    fileSize: 512_000,
    parts: 48,
  },
}).any();

type StaffRow = typeof staffTable.$inferSelect;
type ConversationRow = typeof conversationsTable.$inferSelect;

function presentedInboundSecret(req: Request): string | undefined {
  const direct = req.header("x-sendgrid-inbound-secret")?.trim();
  if (direct) return direct;
  const authorization = req.header("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return typeof req.query.secret === "string" ? req.query.secret.trim() : undefined;
}

function parseInboundMultipart(req: Request, res: Response, next: NextFunction) {
  inboundMultipart(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(error.code.startsWith("LIMIT_") ? 413 : 400).json({
        error: "Inbound email payload exceeds accepted limits",
      });
      return;
    }
    res.status(400).json({ error: "Invalid inbound email payload" });
  });
}

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
  const actor =
    (res.locals.staffActor as StaffRow | undefined) ??
    (await actorStaffFromRequest(req));
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

async function getOrCreateOneToOneConversation(
  senderId: number,
  recipientId: number,
): Promise<ConversationRow | undefined> {
  const [aId, bId] =
    senderId < recipientId
      ? [senderId, recipientId]
      : [recipientId, senderId];
  const [inserted] = await db
    .insert(conversationsTable)
    .values({ participantAId: aId, participantBId: bId, isGroup: false })
    .onConflictDoNothing({
      target: [
        conversationsTable.participantAId,
        conversationsTable.participantBId,
      ],
    })
    .returning();
  return (
    inserted ??
    (await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.participantAId, aId),
          eq(conversationsTable.participantBId, bId),
        ),
      )
      .then((rows) => rows[0]))
  );
}

async function restoreConversationForStaff(
  conversationId: number,
  staffId: number,
): Promise<void> {
  await db
    .delete(conversationArchivesTable)
    .where(
      and(
        eq(conversationArchivesTable.conversationId, conversationId),
        eq(conversationArchivesTable.staffId, staffId),
      ),
    );
}

// ── Summary builder ───────────────────────────────────────────────────────────

async function buildSummary(convo: ConversationRow, viewerId: number, archived = false) {
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
      archived,
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
    archived,
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

// Public only in the sense that SendGrid does not have a Clerk browser
// session. The endpoint fails closed behind an independent webhook secret,
// signed conversation token, authenticated sender result, and replay record.
router.post(
  "/webhooks/sendgrid/inbound",
  (req: Request, res: Response, next: NextFunction) => {
    const config = inboundBridgeConfiguration();
    if (config.status !== "configured") {
      console.error(
        JSON.stringify({
          event: "sendgrid_inbound_unavailable",
          status: config.status,
          missing: config.status === "not_configured" ? config.missing : undefined,
        }),
      );
      res.status(503).json({ error: "Inbound email bridge is unavailable" });
      return;
    }
    if (
      verifyInboundWebhookSecret(
        presentedInboundSecret(req),
        config.webhookSecret,
      ) !== "ok"
    ) {
      res.status(401).json({ error: "Invalid webhook credential" });
      return;
    }
    next();
  },
  parseInboundMultipart,
  async (req: Request, res: Response) => {
    const config = inboundBridgeConfiguration();
    if (config.status !== "configured") {
      res.status(503).json({ error: "Inbound email bridge is unavailable" });
      return;
    }
    const parsed = InboundEmailBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inbound email fields" });
      return;
    }

    let rawEnvelope: unknown;
    try {
      rawEnvelope = JSON.parse(parsed.data.envelope);
    } catch {
      res.status(400).json({ error: "Invalid inbound email envelope" });
      return;
    }
    const envelope = InboundEnvelope.safeParse(rawEnvelope);
    if (!envelope.success) {
      res.status(400).json({ error: "Invalid inbound email envelope" });
      return;
    }

    const token = extractInboundReplyToken(
      envelope.data.to,
      config.inboundDomain,
    );
    if (!token) {
      res.status(400).json({ error: "No valid conversation reply address" });
      return;
    }
    const verification = verifyReplyToken(token, config.tokenSecret);
    if (verification.status === "expired") {
      res.status(410).json({ error: "Conversation reply address has expired" });
      return;
    }
    if (verification.status !== "ok") {
      res.status(403).json({ error: "Invalid conversation reply address" });
      return;
    }

    const { conversationId, inspectorId, supervisorId } = verification.claims;
    const [convo] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    const participantIds = new Set([
      convo?.participantAId ?? 0,
      convo?.participantBId ?? 0,
    ]);
    if (
      !convo ||
      convo.isGroup ||
      participantIds.size !== 2 ||
      !participantIds.has(inspectorId) ||
      !participantIds.has(supervisorId)
    ) {
      res.status(403).json({ error: "Conversation reply address is not authorized" });
      return;
    }

    const [inspector, supervisor] = await Promise.all([
      getStaff(inspectorId),
      getStaff(supervisorId),
    ]);
    if (
      !inspector ||
      inspector.role !== "inspector" ||
      !isMessageRecipientEligible(inspector) ||
      !supervisor ||
      supervisor.role !== "supervisor" ||
      !isMessageRecipientEligible(supervisor)
    ) {
      res.status(403).json({ error: "Conversation participants are not authorized" });
      return;
    }

    const expectedSender = inspector.email
      ? normalizeEmailAddress(inspector.email)
      : null;
    const envelopeSender = normalizeEmailAddress(envelope.data.from);
    const visibleSender = normalizeEmailAddress(parsed.data.from);
    if (
      expectedSender !== INSPECTOR_CHANNEL_EMAIL ||
      envelopeSender !== expectedSender ||
      visibleSender !== expectedSender
    ) {
      res.status(403).json({ error: "Inbound sender is not authorized" });
      return;
    }
    if (
      !inboundSenderAuthenticationPasses(
        parsed.data.SPF ?? parsed.data.spf,
        parsed.data.dkim,
        expectedSender,
      )
    ) {
      res.status(403).json({ error: "Inbound sender authentication failed" });
      return;
    }

    const messageBody = sanitizeInboundPlainText(parsed.data.text);
    if (!messageBody) {
      res.status(400).json({ error: "Inbound reply did not contain plain text" });
      return;
    }
    const providerMessageId = inboundProviderMessageId({
      headers: parsed.data.headers,
      envelope: parsed.data.envelope,
      from: parsed.data.from,
      subject: parsed.data.subject,
      text: parsed.data.text,
    });
    const preview =
      messageBody.length > 120
        ? `${messageBody.slice(0, 117)}...`
        : messageBody;

    try {
      const result = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .insert(inboundEmailMessagesTable)
          .values({ providerMessageId, conversationId, senderId: inspectorId })
          .onConflictDoNothing({
            target: inboundEmailMessagesTable.providerMessageId,
          })
          .returning({
            providerMessageId: inboundEmailMessagesTable.providerMessageId,
          });
        if (!claimed) {
          const [existing] = await tx
            .select({ messageId: inboundEmailMessagesTable.messageId })
            .from(inboundEmailMessagesTable)
            .where(
              eq(
                inboundEmailMessagesTable.providerMessageId,
                providerMessageId,
              ),
            );
          return {
            status: "duplicate" as const,
            messageId: existing?.messageId ?? null,
          };
        }

        const [message] = await tx
          .insert(messagesTable)
          .values({
            conversationId,
            senderId: inspectorId,
            body: messageBody,
          })
          .returning();
        await tx
          .update(inboundEmailMessagesTable)
          .set({ messageId: message.id })
          .where(
            eq(inboundEmailMessagesTable.providerMessageId, providerMessageId),
          );
        await tx
          .delete(conversationArchivesTable)
          .where(eq(conversationArchivesTable.conversationId, conversationId));
        await tx.insert(notificationsTable).values({
          staffId: supervisorId,
          type: "inspector_to_supervisor",
          message: `URGENT: Email reply from ${inspector.name}: ${preview}`,
          isRead: false,
        });
        return { status: "accepted" as const, messageId: message.id };
      });

      const assignment = result.messageId
        ? await autoAssignInspectorMessage({
            messageId: result.messageId,
            managerId: supervisorId,
            messageBody,
          })
        : {
            status: "triage_required" as const,
            reason: "missing_location" as const,
          };

      console.info(
        JSON.stringify({
          event: "sendgrid_inbound_reply",
          status: result.status,
          conversationId,
          inspectorId,
          supervisorId,
          assignmentStatus: assignment.status,
        }),
      );
      res.status(200).json({ ...result, assignment });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "sendgrid_inbound_reply",
          status: "failed",
          conversationId,
          error: error instanceof Error ? error.message : "Unknown database error",
        }),
      );
      res.status(500).json({ error: "Failed to save inbound email reply" });
    }
  },
);

router.get("/conversations", async (req: Request, res: Response) => {
  const query = ListConversationsQuery.safeParse({
    staffId: req.query.staffId,
    archived: req.query.archived,
  });
  if (!query.success) {
    res.status(400).json({ error: "staffId is required" });
    return;
  }
  const actor = await requireActor(req, res, query.data.staffId);
  if (!actor) return;
  const staffId = actor.id;
  const includeArchived = query.data.archived === "true";

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

  const archivedRows = await db
    .select({ conversationId: conversationArchivesTable.conversationId })
    .from(conversationArchivesTable)
    .where(eq(conversationArchivesTable.staffId, staffId));
  const archivedIds = new Set(archivedRows.map((row) => row.conversationId));
  const convos = filterConversationsByArchiveState(
    [...oneToOne, ...groupConvos],
    archivedIds,
    includeArchived,
  );
  const summaries = await Promise.all(
    convos.map((conversation) => buildSummary(conversation, staffId, includeArchived)),
  );
  summaries.sort((a, b) => {
    const ta = a.lastMessageAt ?? a.createdAt;
    const tb = b.lastMessageAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });
  res.json(summaries);
});

// Resolve the dedicated inspector channel server-side. Supervisors never need
// the inspector's private login email in the staff-directory response, and a
// second inspector record cannot be selected accidentally.
router.post(
  "/conversations/inspector-channel",
  async (req: Request, res: Response) => {
    const body = InspectorChannelBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "staffId is required" });
      return;
    }
    const sender = await requireActor(req, res, body.data.staffId);
    if (!sender) return;
    if (sender.role !== "supervisor") {
      res.status(403).json({ error: "Only supervisors can open the inspector email channel" });
      return;
    }
    const [inspector] = await db
      .select()
      .from(staffTable)
      .where(
        and(
          eq(staffTable.role, "inspector"),
          eq(staffTable.active, true),
          eq(staffTable.loginEnabled, true),
          sql`lower(btrim(${staffTable.email})) = ${INSPECTOR_CHANNEL_EMAIL}`,
        ),
      )
      .limit(1);
    if (!inspector || !isMessageRecipientEligible(inspector)) {
      res.status(503).json({ error: "The inspector email channel is unavailable" });
      return;
    }
    const convo = await getOrCreateOneToOneConversation(sender.id, inspector.id);
    if (!convo) {
      res.status(500).json({ error: "Failed to create inspector conversation" });
      return;
    }
    await restoreConversationForStaff(convo.id, sender.id);
    res.json(await buildSummary(convo, sender.id));
  },
);

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
  if (!recipient || !isMessageRecipientEligible(recipient)) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (!canStart(sender, recipient)) {
    res.status(403).json({ error: "You are not allowed to message this person" });
    return;
  }
  const convo = await getOrCreateOneToOneConversation(sender.id, recipientId);
  if (!convo) {
    res.status(500).json({ error: "Failed to create conversation" });
    return;
  }
  await restoreConversationForStaff(convo.id, sender.id);
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
  const uniqueRecipientIds = [...new Set(recipientIds)].filter(
    (staffId) => staffId !== sender.id,
  );
  if (uniqueRecipientIds.length < 1) {
    res.status(400).json({ error: "At least one recipient is required" });
    return;
  }

  const recipients = await db
    .select()
    .from(staffTable)
    .where(inArray(staffTable.id, uniqueRecipientIds));
  if (invalidMessageRecipientIds(uniqueRecipientIds, recipients).length > 0) {
    res.status(400).json({ error: "One or more recipients are unavailable" });
    return;
  }

  const allIds = [sender.id, ...uniqueRecipientIds];
  const convo = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversationsTable)
      .values({ isGroup: true, groupName: groupName || null })
      .returning();
    await tx.insert(conversationParticipantsTable).values(
      allIds.map((staffId) => ({ conversationId: created.id, staffId })),
    );
    return created;
  });

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
      clientRequestId: messagesTable.clientRequestId,
      emailDeliveryStatus: messageEmailOutboxTable.status,
      isInboundEmail: sql<boolean>`${inboundEmailMessagesTable.messageId} IS NOT NULL`,
    })
    .from(messagesTable)
    .innerJoin(staffTable, eq(messagesTable.senderId, staffTable.id))
    .leftJoin(
      messageEmailOutboxTable,
      eq(messageEmailOutboxTable.messageId, messagesTable.id),
    )
    .leftJoin(
      inboundEmailMessagesTable,
      eq(inboundEmailMessagesTable.messageId, messagesTable.id),
    )
    .where(eq(messagesTable.conversationId, params.data.id))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));

  const assignmentRows =
    rows.length === 0
      ? []
      : await db
          .select({
            sourceMessageId: inspectorTaskLinksTable.sourceMessageId,
            taskId: inspectorTaskLinksTable.taskId,
            dueAt: inspectorTaskLinksTable.dueAt,
            escalatedAt: inspectorTaskLinksTable.escalatedAt,
            assignmentMethod: inspectorTaskLinksTable.assignmentMethod,
            completed: tasksTable.completed,
            assignedStaffId: tasksTable.assignedToId,
            assignedStaffName: staffTable.name,
            areaName: areasTable.name,
          })
          .from(inspectorTaskLinksTable)
          .innerJoin(tasksTable, eq(inspectorTaskLinksTable.taskId, tasksTable.id))
          .innerJoin(areasTable, eq(tasksTable.areaId, areasTable.id))
          .leftJoin(staffTable, eq(tasksTable.assignedToId, staffTable.id))
          .where(
            inArray(
              inspectorTaskLinksTable.sourceMessageId,
              rows.map((row) => row.id),
            ),
          );
  const assignmentByMessage = new Map(
    assignmentRows.map((assignment) => [
      assignment.sourceMessageId,
      assignment,
    ]),
  );
  res.json(
    rows.map((message) => {
      const assignment = assignmentByMessage.get(message.id);
      return {
        ...message,
        emailDeliveryStatus:
          message.emailDeliveryStatus ?? ("not_applicable" as const),
        specialTaskId: assignment?.taskId ?? null,
        specialTaskDueAt: assignment?.dueAt.toISOString() ?? null,
        specialTaskEscalatedAt: assignment?.escalatedAt?.toISOString() ?? null,
        specialTaskCompleted: assignment?.completed ?? null,
        specialTaskAssignedStaffId: assignment?.assignedStaffId ?? null,
        specialTaskAssignedStaffName: assignment?.assignedStaffName ?? null,
        specialTaskAreaName: assignment?.areaName ?? null,
        specialTaskAssignmentMethod: assignment?.assignmentMethod ?? null,
        createdAt: message.createdAt.toISOString(),
      };
    }),
  );
});

// Convert an authenticated inspector email message into a special assignment.
// The source message must be an accepted inbound SendGrid reply and the
// requesting manager must be a participant in that inspector conversation.
router.post(
  "/conversations/:id/messages/:msgId/assign-special",
  async (req: Request, res: Response) => {
    const params = MessageParams.safeParse({
      id: req.params.id,
      msgId: req.params.msgId,
    });
    const body = AssignInspectorMessageBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid assignment request" });
      return;
    }
    const actor = await requireActor(req, res, body.data.staffId);
    if (!actor) return;
    if (actor.role !== "supervisor" && actor.role !== "admin") {
      res.status(403).json({ error: "Only a manager can triage inspector email" });
      return;
    }
    const access = await loadConversationForParticipant(params.data.id, actor.id);
    if (access.status !== undefined) {
      sendConvoError(res, access.status);
      return;
    }

    const [message] = await db
      .select({ body: messagesTable.body, conversationId: messagesTable.conversationId })
      .from(messagesTable)
      .where(eq(messagesTable.id, params.data.msgId));
    if (!message || message.conversationId !== params.data.id) {
      res.status(404).json({ error: "Inspector message not found" });
      return;
    }

    const result = await assignInspectorMessageToStaff({
      messageId: params.data.msgId,
      managerId: actor.id,
      areaId: body.data.areaId,
      taskDate: body.data.taskDate ?? airportDate(),
      targetCoordinates: extractInspectorTargetCoordinates(message.body),
    });
    if (result.status === "message_not_found") {
      res.status(404).json({ error: "Inspector message not found" });
      return;
    }
    if (result.status === "not_authorized") {
      res.status(403).json({ error: "Inspector message is not authorized for assignment" });
      return;
    }
    if (result.status === "invalid_area") {
      res.status(400).json({ error: "Selected area is invalid or archived" });
      return;
    }
    if (result.status === "no_eligible_staff") {
      res.status(409).json({ error: "No active on-area staff member is assigned for this date" });
      return;
    }
    res.status(result.status === "assigned" ? 201 : 200).json(result);
  },
);

router.patch("/conversations/:id/archive", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  const body = ArchiveBody.safeParse(req.body);
  if (!params.success || !body.success) {
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

  if (body.data.archived) {
    await db
      .insert(conversationArchivesTable)
      .values({ conversationId: params.data.id, staffId: actor.id })
      .onConflictDoUpdate({
        target: [
          conversationArchivesTable.conversationId,
          conversationArchivesTable.staffId,
        ],
        set: { archivedAt: new Date() },
      });
  } else {
    await db
      .delete(conversationArchivesTable)
      .where(
        and(
          eq(conversationArchivesTable.conversationId, params.data.id),
          eq(conversationArchivesTable.staffId, actor.id),
        ),
      );
  }

  res.json({ archived: body.data.archived });
});

router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  const params = IdParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = SendMessageBody.safeParse(req.body);
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
  let oneToOneRecipient: StaffRow | undefined;
  if (!convo.isGroup) {
    const recipientId =
      convo.participantAId === sender.id ? convo.participantBId! : convo.participantAId!;
    const recipient = await getStaff(recipientId);
    if (!recipient || !isMessageRecipientEligible(recipient)) {
      res.status(404).json({ error: "Staff member not found" });
      return;
    }
    if (!isAllowedPair(sender, recipient)) {
      res.status(403).json({ error: "You are not allowed to message this person" });
      return;
    }
    oneToOneRecipient = recipient;
  }

  const preview =
    body.data.body.length > 120 ? `${body.data.body.slice(0, 117)}...` : body.data.body;

  const requiresInspectorEmail =
    !convo.isGroup &&
    sender.role === "supervisor" &&
    oneToOneRecipient?.role === "inspector" &&
    normalizeEmailAddress(oneToOneRecipient.email ?? "") ===
      INSPECTOR_CHANNEL_EMAIL;
  const initialDeliveryStatus = initialEmailDeliveryStatus(
    requiresInspectorEmail,
    outboundBridgeConfiguration(),
  );

  // Message, idempotency key, inbox state, notification, and outbound email
  // intent commit together. A process may stop immediately after the HTTP
  // response; a future instance can still claim and deliver the durable row.
  let transactionResult:
    | {
        outcome: "created" | "replayed";
        message: typeof messagesTable.$inferSelect;
        emailDeliveryStatus: PublicEmailDeliveryStatus;
      }
    | { outcome: "conflict" };
  try {
    transactionResult = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messagesTable)
        .values({
          conversationId: convo.id,
          senderId: sender.id,
          clientRequestId: body.data.clientRequestId,
          body: body.data.body,
        })
        .onConflictDoNothing({
          target: [messagesTable.senderId, messagesTable.clientRequestId],
        })
        .returning();

      if (!created) {
        const [existing] = await tx
          .select()
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.senderId, sender.id),
              eq(messagesTable.clientRequestId, body.data.clientRequestId),
            ),
          );
        if (
          !existing ||
          !isExactMessageReplay(existing, {
            conversationId: convo.id,
            senderId: sender.id,
            clientRequestId: body.data.clientRequestId,
            body: body.data.body,
          })
        ) {
          return { outcome: "conflict" as const };
        }
        const [outbox] = await tx
          .select({ status: messageEmailOutboxTable.status })
          .from(messageEmailOutboxTable)
          .where(eq(messageEmailOutboxTable.messageId, existing.id));
        return {
          outcome: "replayed" as const,
          message: existing,
          emailDeliveryStatus:
            outbox?.status ?? ("not_applicable" as const),
        };
      }

      // A new message makes the conversation active again for every participant.
      // The message itself and all history remain intact.
      await tx
        .delete(conversationArchivesTable)
        .where(eq(conversationArchivesTable.conversationId, convo.id));

      if (convo.isGroup) {
        const parts = await tx
          .select({
            staffId: conversationParticipantsTable.staffId,
            active: staffTable.active,
            loginEnabled: staffTable.loginEnabled,
            email: staffTable.email,
          })
          .from(conversationParticipantsTable)
          .innerJoin(
            staffTable,
            eq(conversationParticipantsTable.staffId, staffTable.id),
          )
          .where(eq(conversationParticipantsTable.conversationId, convo.id));
        const others = parts.filter(
          (participant) =>
            participant.staffId !== sender.id &&
            isMessageRecipientEligible({
              id: participant.staffId,
              active: participant.active,
              loginEnabled: participant.loginEnabled,
              email: participant.email,
            }),
        );
        if (others.length > 0) {
          await tx.insert(notificationsTable).values(
            others.map((participant) => ({
              staffId: participant.staffId,
              type: "new_message" as const,
              message: `💬 ${sender.name}: ${preview}`,
            })),
          );
        }
      } else {
        await tx.insert(notificationsTable).values({
          staffId: oneToOneRecipient!.id,
          type: "new_message" as const,
          message: `💬 New message from ${sender.name}: ${preview}`,
        });
      }

      if (requiresInspectorEmail && initialDeliveryStatus !== "not_applicable") {
        await tx.insert(messageEmailOutboxTable).values({
          messageId: created.id,
          conversationId: convo.id,
          inspectorId: oneToOneRecipient!.id,
          supervisorId: sender.id,
          inspectorEmail: oneToOneRecipient!.email!,
          inspectorName: oneToOneRecipient!.name,
          supervisorName: sender.name,
          messageBody: body.data.body,
          status: initialDeliveryStatus,
        });
      }

      return {
        outcome: "created" as const,
        message: created,
        emailDeliveryStatus: initialDeliveryStatus,
      };
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "conversation_message_create",
        status: "failed",
        conversationId: convo.id,
        senderId: sender.id,
        error: error instanceof Error ? error.message : "Unknown database error",
      }),
    );
    res.status(500).json({ error: "Failed to save message" });
    return;
  }

  if (transactionResult.outcome === "conflict") {
    res.status(409).json({
      error: "This clientRequestId was already used for a different message",
    });
    return;
  }

  const { message } = transactionResult;
  let { emailDeliveryStatus } = transactionResult;
  if (emailDeliveryStatus === "pending" || emailDeliveryStatus === "sending") {
    try {
      emailDeliveryStatus = await attemptMessageEmailOutboxDelivery(message.id);
    } catch (error) {
      // The app message and outbox row are already committed. Preserve that
      // honest state for the client and let a current/future worker retry.
      console.error(
        JSON.stringify({
          event: "inspector_message_email_initial_attempt",
          status: "failed",
          messageId: message.id,
          error: error instanceof Error ? error.message : "Unknown outbox error",
        }),
      );
      wakeMessageEmailOutboxWorker();
    }
  }
  if (emailDeliveryStatus !== "not_applicable") {
    res.setHeader("X-Inspector-Email-Status", emailDeliveryStatus);
  }
  if (emailDeliveryStatus === "pending" || emailDeliveryStatus === "retrying") {
    wakeMessageEmailOutboxWorker();
  }
  if (transactionResult.outcome === "replayed") {
    res.setHeader("Idempotent-Replayed", "true");
  }

  res.status(transactionResult.outcome === "created" ? 201 : 200).json({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: sender.name,
    body: message.body,
    isRead: message.isRead,
    clientRequestId: message.clientRequestId,
    emailDeliveryStatus,
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

  const [emailOutbox, inboundEmail, inspectorTaskReference] =
    await Promise.all([
      db
        .select({ messageId: messageEmailOutboxTable.messageId })
        .from(messageEmailOutboxTable)
        .where(eq(messageEmailOutboxTable.messageId, existing.id))
        .then((rows) => rows[0]),
      db
        .select({ messageId: inboundEmailMessagesTable.messageId })
        .from(inboundEmailMessagesTable)
        .where(eq(inboundEmailMessagesTable.messageId, existing.id))
        .then((rows) => rows[0]),
      db
        .select({ taskId: inspectorTaskLinksTable.taskId })
        .from(inspectorTaskLinksTable)
        .where(
          or(
            eq(inspectorTaskLinksTable.sourceMessageId, existing.id),
            eq(inspectorTaskLinksTable.completionMessageId, existing.id),
          ),
        )
        .then((rows) => rows[0]),
    ]);
  if (emailOutbox || inboundEmail || inspectorTaskReference) {
    res.status(409).json({
      error:
        "Email-linked inspector messages cannot be edited because they are part of the task audit trail.",
    });
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

  const [outbox] = await db
    .select({ status: messageEmailOutboxTable.status })
    .from(messageEmailOutboxTable)
    .where(eq(messageEmailOutboxTable.messageId, updated.id));

  res.json({
    id: updated.id,
    conversationId: updated.conversationId,
    senderId: updated.senderId,
    senderName: actor.name,
    body: updated.body,
    isRead: updated.isRead,
    clientRequestId: updated.clientRequestId,
    emailDeliveryStatus: outbox?.status ?? ("not_applicable" as const),
    createdAt: updated.createdAt.toISOString(),
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
