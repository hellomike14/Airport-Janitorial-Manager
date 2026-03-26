import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { issuesTable } from "./issues";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  issueId: integer("issue_id").references(() => issuesTable.id),
  type: text("type", { enum: ["new_issue", "issue_assigned", "issue_completed", "inspector_to_supervisor", "supervisor_to_inspector"] }).notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
