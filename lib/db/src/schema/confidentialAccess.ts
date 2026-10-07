import { pgTable, integer, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const confidentialSettingsTable = pgTable("confidential_access_settings", {
  id: integer("id").primaryKey(),
  codeHash: text("code_hash"),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const confidentialAttemptsTable = pgTable("confidential_access_attempts", {
  settingsId: integer("settings_id").notNull().references(() => confidentialSettingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  failures: integer("failures").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.settingsId, t.staffId] })]);
export const confidentialGrantsTable = pgTable("confidential_access_grants", {
  tokenHash: text("token_hash").primaryKey(),
  settingsId: integer("settings_id").notNull().references(() => confidentialSettingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(),
  version: integer("version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  quickbooksStateHash: text("quickbooks_state_hash"),
});
export const confidentialEventsTable = pgTable("confidential_access_events", {
  id: text("id").primaryKey(),
  settingsId: integer("settings_id").notNull().references(() => confidentialSettingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
