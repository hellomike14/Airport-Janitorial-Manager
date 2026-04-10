import { pgTable, text, serial, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areasTable } from "./areas";
import { staffTable } from "./staff";

export const taskTypesTable = pgTable("task_types", {
  id: serial("id").primaryKey(),
  taskName: text("task_name").notNull(),
  taskOrder: integer("task_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TaskType = typeof taskTypesTable.$inferSelect;

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => areasTable.id),
  taskDate: date("task_date").notNull(),
  taskName: text("task_name").notNull(),
  taskOrder: integer("task_order").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedById: integer("completed_by_id").references(() => staffTable.id),
  assignedToId: integer("assigned_to_id").references(() => staffTable.id),
  isSpecial: boolean("is_special").notNull().default(false),
  createdById: integer("created_by_id").references(() => staffTable.id),
  notes: text("notes"),
  beforeImagePath: text("before_image_path"),
  afterImagePath: text("after_image_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
