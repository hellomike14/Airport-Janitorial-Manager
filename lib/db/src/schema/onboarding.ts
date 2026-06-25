import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { jobApplicationsTable } from "./jobApplications";

export const onboardingHiresTable = pgTable("onboarding_hires", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position"),
  applicationId: integer("application_id").references(() => jobApplicationsTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const onboardingItemsTable = pgTable("onboarding_items", {
  id: serial("id").primaryKey(),
  hireId: integer("hire_id")
    .notNull()
    .references(() => onboardingHiresTable.id, { onDelete: "cascade" }),
  category: text("category", {
    enum: ["step", "document", "training", "walkthrough"],
  })
    .notNull()
    .default("step"),
  title: text("title").notNull(),
  description: text("description"),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OnboardingHire = typeof onboardingHiresTable.$inferSelect;
export type OnboardingItem = typeof onboardingItemsTable.$inferSelect;
export type OnboardingItemCategory = OnboardingItem["category"];
