import { pgTable, text, serial, integer, boolean, timestamp, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staffTable } from "./staff";

// participantAId / participantBId are null for group conversations;
// non-null (with the ordered-pair constraint) for 1:1 conversations.
export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    participantAId: integer("participant_a_id").references(() => staffTable.id),
    participantBId: integer("participant_b_id").references(() => staffTable.id),
    isGroup: boolean("is_group").notNull().default(false),
    groupName: text("group_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("conversations_participants_unique").on(t.participantAId, t.participantBId),
    check("conversations_participants_ordered", sql`${t.participantAId} < ${t.participantBId}`),
  ]
);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
  senderId: integer("sender_id").notNull().references(() => staffTable.id),
  // A UUID generated per compose action. NULL is retained for historic and
  // inbound messages; the unique pair makes retries safe without rewriting
  // old conversations.
  clientRequestId: text("client_request_id"),
  body: text("body").notNull(),
  beforeImagePath: text("before_image_path"),
  afterImagePath: text("after_image_path"),
  isRead: boolean("is_read").notNull().default(false),
  // Body edits advance this version so acknowledgments never carry forward
  // from an earlier message body. Existing rows start at version 1.
  receiptVersion: integer("receipt_version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("messages_sender_client_request_unique").on(t.senderId, t.clientRequestId)]);

export type MessageReceiptDirection = "to_inspector" | "from_inspector";

/**
 * Append-only receipt evidence. Deliberately no foreign keys: message cleanup
 * and staff archival must not cascade-delete previously recorded evidence.
 */
export const messageReceiptAcknowledgementsTable = pgTable(
  "message_receipt_acknowledgements",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    messageId: integer("message_id").notNull(),
    messageVersion: integer("message_version").notNull(),
    bodySha256: text("body_sha256").notNull(),
    direction: text("direction").$type<MessageReceiptDirection>().notNull(),
    confirmedByStaffId: integer("confirmed_by_staff_id").notNull(),
    confirmedByName: text("confirmed_by_name").notNull(),
    confirmedByRole: text("confirmed_by_role").notNull(),
    confirmedAt: timestamp("confirmed_at").notNull().defaultNow(),
  },
  (t) => [
    unique("message_receipt_acknowledgements_message_version_unique").on(t.messageId, t.messageVersion),
    index("message_receipt_acknowledgements_conversation_idx").on(t.conversationId, t.messageId),
    check("message_receipt_acknowledgements_version_positive", sql`${t.messageVersion} > 0`),
  ],
);

export type MessageEmailDeliveryStatus = "pending" | "sending" | "retrying" | "accepted" | "disabled" | "not_configured" | "failed";

/** Transactional email intent; a worker owns external delivery. */
export const messageEmailOutboxTable = pgTable("message_email_outbox", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").notNull(),
  inspectorId: integer("inspector_id").notNull(),
  supervisorId: integer("supervisor_id").notNull(),
  inspectorEmail: text("inspector_email").notNull(),
  inspectorName: text("inspector_name").notNull(),
  supervisorName: text("supervisor_name").notNull(),
  messageBody: text("message_body").notNull(),
  status: text("status").$type<MessageEmailDeliveryStatus>().notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  lockedAt: timestamp("locked_at"),
  lockToken: text("lock_token"),
  lastError: text("last_error"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("message_email_outbox_message_recipient_unique").on(t.messageId, t.inspectorEmail),
  index("message_email_outbox_ready_idx").on(t.status, t.nextAttemptAt),
  check("message_email_outbox_status_valid", sql`${t.status} IN ('pending','sending','retrying','accepted','disabled','not_configured','failed')`),
]);

// Per-participant tracking for group conversations (also used to track
// last-read position so unread counts work per user in a group).
export const conversationParticipantsTable = pgTable(
  "conversation_participants",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id),
    lastReadAt: timestamp("last_read_at"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [unique("conversation_participants_unique").on(t.conversationId, t.staffId)]
);

/** Per-user archive state; no conversation history is ever deleted. */
export const conversationArchivesTable = pgTable("conversation_archives", {
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
}, (t) => [unique("conversation_archives_unique").on(t.conversationId, t.staffId)]);

/** Hashed provider identifier used to make inbound SendGrid retries safe. */
export const inboundEmailMessagesTable = pgTable("inbound_email_messages", {
  providerMessageId: text("provider_message_id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => staffTable.id),
  messageId: integer("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;
export type MessageEmailOutbox = typeof messageEmailOutboxTable.$inferSelect;
