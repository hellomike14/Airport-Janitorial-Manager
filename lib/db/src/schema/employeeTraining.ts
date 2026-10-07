import { pgTable, serial, integer, text, timestamp, doublePrecision, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const trainingProgressTable = pgTable("training_progress", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  version: text("version").notNull(),
  watchedRanges: jsonb("watched_ranges").$type<[number, number][]>().notNull().default([]),
  sessionId: text("session_id"),
  lastPosition: doublePrecision("last_position").notNull().default(0),
  wasPlaying: boolean("was_playing").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("training_progress_staff_version_unique").on(t.staffId, t.version)]);

export const trainingAcknowledgmentsTable = pgTable("training_acknowledgments", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  version: text("version").notNull(),
  trainingTitle: text("training_title").notNull(),
  videoSha256: text("video_sha256").notNull(),
  signature: text("signature").notNull(),
  staffName: text("staff_name").notNull(),
  watchedConfirmation: boolean("watched_confirmation").notNull(),
  understoodConfirmation: boolean("understood_confirmation").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("training_acknowledgments_staff_version_unique").on(t.staffId, t.version)]);
