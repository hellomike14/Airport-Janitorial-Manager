import { pgTable, text, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type EmploymentFormId =
  | "job-application"
  | "i-9"
  | "w-4"
  | "onboarding-cover"
  | "administrative-checklist"
  | "conditional-offer"
  | "offer-acceptance"
  | "acceptance-receipt"
  | "start-confirmation"
  | "offer-tracking"
  | "emergency-contact"
  | "payroll-setup"
  | "language-accessibility"
  | "uniform-equipment-issue"
  | "site-orientation"
  | "orientation-acknowledgment"
  | "training-attendance"
  | "video-attestation"
  | "knowledge-check"
  | "knowledge-check-guide"
  | "practical-assessment"
  | "buddy-shift"
  | "independent-work-release"
  | "day-7-review"
  | "day-30-review"
  | "day-60-review"
  | "day-90-review"
  | "exception-correction"
  | "badging-checklist"
  | "badge-rules-acknowledgment"
  | "badge-control"
  | "i9-everify-tracker"
  | "training-matrix";
export type EmploymentFormEmailStatus = "pending" | "sent" | "failed";

export type EmploymentFormAttachment = {
  name: string;
  path: string;
  contentType: string;
};

export const employmentFormSubmissionsTable = pgTable("employment_form_submissions", {
  id: serial("id").primaryKey(),
  formId: text("form_id", {
    enum: [
      "job-application", "i-9", "w-4", "onboarding-cover", "administrative-checklist",
      "conditional-offer", "offer-acceptance", "acceptance-receipt", "start-confirmation",
      "offer-tracking", "emergency-contact", "payroll-setup", "language-accessibility",
      "uniform-equipment-issue", "site-orientation", "orientation-acknowledgment",
      "training-attendance", "video-attestation", "knowledge-check", "knowledge-check-guide",
      "practical-assessment", "buddy-shift", "independent-work-release", "day-7-review",
      "day-30-review", "day-60-review", "day-90-review", "exception-correction",
      "badging-checklist", "badge-rules-acknowledgment", "badge-control",
      "i9-everify-tracker", "training-matrix",
    ],
  }).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  completedPdfPath: text("completed_pdf_path").notNull(),
  idPhotos: jsonb("id_photos").$type<EmploymentFormAttachment[]>().notNull().default([]),
  emailStatus: text("email_status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmploymentFormSubmissionSchema = createInsertSchema(employmentFormSubmissionsTable)
  .omit({ id: true, submittedAt: true });

export type InsertEmploymentFormSubmission = z.infer<typeof insertEmploymentFormSubmissionSchema>;
export type EmploymentFormSubmission = typeof employmentFormSubmissionsTable.$inferSelect;
