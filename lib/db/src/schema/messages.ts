import { pgTable, text, serial, integer, boolean, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staffTable } from "./staff";

// A direct 1:1 conversation between two staff members. participantAId is
// always the lower staff id so a pair maps to exactly one row; the unique
// constraint enforces one-thread-per-pair at the database level.
export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    participantAId: integer("participant_a_id").notNull().references(() => staffTable.id),
    participantBId: integer("participant_b_id").notNull().references(() => staffTable.id),
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

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
