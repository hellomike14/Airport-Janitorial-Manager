import { pgTable, integer, serial, timestamp, text, unique, index, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tasksTable } from "./tasks";
import { messagesTable, conversationsTable } from "./messages";
import { staffTable } from "./staff";

/** Immutable source/SLA record for each inspector-originated special task. */
export const inspectorTaskLinksTable = pgTable("inspector_task_links", {
  taskId: integer("task_id").primaryKey().references(() => tasksTable.id, { onDelete: "cascade" }),
  sourceMessageId: integer("source_message_id").notNull().references(() => messagesTable.id),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
  inspectorId: integer("inspector_id").notNull().references(() => staffTable.id),
  supervisorId: integer("supervisor_id").notNull().references(() => staffTable.id),
  assignmentMethod: text("assignment_method").$type<"fresh_gps" | "area_roster_workload">().notNull(),
  assignmentDistanceMeters: doublePrecision("assignment_distance_meters"),
  targetLatitude: doublePrecision("target_latitude"),
  targetLongitude: doublePrecision("target_longitude"),
  dueAt: timestamp("due_at").notNull(),
  escalatedAt: timestamp("escalated_at"),
  escalationStaffId: integer("escalation_staff_id").references(() => staffTable.id),
  completionMessageId: integer("completion_message_id").references(() => messagesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("inspector_task_links_source_message_unique").on(t.sourceMessageId),
  unique("inspector_task_links_completion_message_unique").on(t.completionMessageId),
  index("inspector_task_links_due_idx").on(t.dueAt).where(sql`${t.escalatedAt} IS NULL`),
]);

/** Append-only assignment/reassignment audit; never replaces the original. */
export const inspectorTaskAssignmentHistoryTable = pgTable("inspector_task_assignment_history", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  assignedStaffId: integer("assigned_staff_id").notNull().references(() => staffTable.id),
  assignedById: integer("assigned_by_id").references(() => staffTable.id),
  event: text("event").notNull(),
  method: text("method").notNull(),
  distanceMeters: doublePrecision("distance_meters"),
  provenance: text("provenance").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("inspector_task_assignment_history_task_idx").on(t.taskId, t.createdAt)]);