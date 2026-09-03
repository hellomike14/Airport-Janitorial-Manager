import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { tasksTable } from "./tasks";
import { conversationsTable } from "./messages";

export const objectUploadsTable = pgTable("object_uploads", {
  id: serial("id").primaryKey(),
  objectPath: text("object_path").notNull(),
  ownerStaffId: integer("owner_staff_id").references(() => staffTable.id),
  purpose: text("purpose", { enum: ["task_before", "task_after", "issue_before", "issue_after", "conversation_attachment", "shared_photo", "application_document"] }).notNull(),
  taskId: integer("task_id").references(() => tasksTable.id),
  conversationId: integer("conversation_id").references(() => conversationsTable.id),
  issueId: integer("issue_id"),
  areaId: integer("area_id"),
  applicantToken: text("applicant_token"),
  claimedAt: timestamp("claimed_at"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("object_uploads_path_unique").on(t.objectPath)]);