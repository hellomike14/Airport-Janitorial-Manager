import { pgTable, text, serial, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areasTable } from "./areas";
import { staffTable } from "./staff";

export const issuesTable = pgTable("issues", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => areasTable.id),
  reportedById: integer("reported_by_id").notNull().references(() => staffTable.id),
  issueDate: date("issue_date").notNull(),
  description: text("description").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high"] }).notNull().default("low"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  beforeImagePath: text("before_image_path"),
  afterImagePath: text("after_image_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIssueSchema = createInsertSchema(issuesTable).omit({ id: true, createdAt: true });
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Issue = typeof issuesTable.$inferSelect;
