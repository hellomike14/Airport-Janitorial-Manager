import { pgTable, text, serial, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areasTable } from "./areas";
import { staffTable } from "./staff";

export const assignmentsTable = pgTable("assignments", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  areaId: integer("area_id").notNull().references(() => areasTable.id),
  assignmentDate: date("assignment_date").notNull(),
  assignedById: integer("assigned_by_id").notNull().references(() => staffTable.id),
  notes: text("notes"),
  isSpecial: boolean("is_special").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({ id: true, createdAt: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignmentsTable.$inferSelect;
