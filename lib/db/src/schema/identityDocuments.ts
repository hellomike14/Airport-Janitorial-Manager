import { pgTable, uuid, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { onboardingHiresTable } from "./onboarding";
import { staffTable } from "./staff";

export const identityDocumentPhotosTable = pgTable("identity_document_photos", {
  id: uuid("id").primaryKey(),
  hireId: integer("hire_id").notNull().references(() => onboardingHiresTable.id, { onDelete: "restrict" }),
  category: text("category", { enum: ["identity", "work_authorization", "social_security"] }).notNull(),
  side: text("side", { enum: ["front", "back"] }).notNull(),
  uploadedById: integer("uploaded_by_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  uploaderName: text("uploader_name").notNull(),
  stagingPath: text("staging_path").notNull(),
  originalPath: text("original_path"),
  imagePath: text("image_path"),
  expectedBytes: integer("expected_bytes").notNull(),
  inputType: text("input_type").notNull(),
  sha256: text("sha256"),
  status: text("status", { enum: ["uploaded", "needs_clearer_photo", "reviewed"] }).notNull().default("uploaded"),
  qualityReason: text("quality_reason"),
  reviewedById: integer("reviewed_by_id").references(() => staffTable.id, { onDelete: "restrict" }),
  reviewerName: text("reviewer_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  replacesId: uuid("replaces_id"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
}, table => [index("identity_photos_hire_index").on(table.hireId)]);

export const identityDocumentEventsTable = pgTable("identity_document_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hireId: integer("hire_id").notNull().references(() => onboardingHiresTable.id, { onDelete: "restrict" }),
  photoId: uuid("photo_id"),
  actorId: integer("actor_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("identity_events_hire_index").on(table.hireId)]);
