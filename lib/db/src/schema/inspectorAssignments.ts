import {
  pgTable,
  integer,
  timestamp,
  text,
  unique,
  index,
  check,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tasksTable } from "./tasks";
import { messagesTable, conversationsTable } from "./messages";
import { staffTable } from "./staff";

export type InspectorAssignmentMethod =
  | "fresh_gps"
  | "area_roster_workload";

/**
 * Durable provenance and SLA state for a task created from authenticated
 * inspector email. The source message is unique, so webhook retries and
 * repeated supervisor clicks cannot create duplicate tasks.
 */
export const inspectorTaskLinksTable = pgTable(
  "inspector_task_links",
  {
    taskId: integer("task_id")
      .primaryKey()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    sourceMessageId: integer("source_message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "restrict" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "restrict" }),
    inspectorId: integer("inspector_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    supervisorId: integer("supervisor_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    assignmentMethod: text("assignment_method")
      .$type<InspectorAssignmentMethod>()
      .notNull(),
    targetLatitude: doublePrecision("target_latitude"),
    targetLongitude: doublePrecision("target_longitude"),
    dueAt: timestamp("due_at").notNull(),
    escalatedAt: timestamp("escalated_at"),
    escalationStaffId: integer("escalation_staff_id").references(
      () => staffTable.id,
      { onDelete: "set null" },
    ),
    completionMessageId: integer("completion_message_id").references(
      () => messagesTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("inspector_task_links_source_message_unique").on(
      table.sourceMessageId,
    ),
    unique("inspector_task_links_completion_message_unique").on(
      table.completionMessageId,
    ),
    index("inspector_task_links_due_idx")
      .on(table.dueAt)
      .where(sql`${table.escalatedAt} IS NULL`),
    check(
      "inspector_task_links_assignment_method_valid",
      sql`${table.assignmentMethod} IN ('fresh_gps', 'area_roster_workload')`,
    ),
  ],
);

export type InspectorTaskLink = typeof inspectorTaskLinksTable.$inferSelect;
