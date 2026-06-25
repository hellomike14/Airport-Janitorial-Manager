import { pgTable, text, serial, jsonb, timestamp } from "drizzle-orm/pg-core";

export type UploadedDocument = {
  name: string;
  path: string;
  contentType?: string;
};

export const jobApplicationsTable = pgTable("job_applications", {
  id: serial("id").primaryKey(),
  status: text("status", { enum: ["new", "reviewing", "hired", "rejected"] })
    .notNull()
    .default("new"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  positionApplied: text("position_applied"),
  application: jsonb("application").$type<Record<string, unknown>>().notNull(),
  i9Employee: jsonb("i9_employee").$type<Record<string, unknown>>().notNull(),
  i9Employer: jsonb("i9_employer").$type<Record<string, unknown>>().notNull(),
  w4Employee: jsonb("w4_employee").$type<Record<string, unknown>>().notNull(),
  w4Employer: jsonb("w4_employer").$type<Record<string, unknown>>().notNull(),
  documents: jsonb("documents").$type<UploadedDocument[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type JobApplication = typeof jobApplicationsTable.$inferSelect;
export type JobApplicationStatus = JobApplication["status"];
