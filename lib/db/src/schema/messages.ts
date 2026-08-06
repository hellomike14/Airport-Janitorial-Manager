import { pgTable, text, serial, integer, boolean, timestamp, unique, check } from "drizzle-orm/pg-core";
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
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;
