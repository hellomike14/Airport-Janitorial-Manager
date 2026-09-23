import { boolean, check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authDiagnosticEventsTable = pgTable("auth_diagnostic_events", {
    diagnosticId: text("diagnostic_id").primaryKey(),
    code: text("code").notNull(),
    source: text("source", { enum: ["server", "client"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, table => [
    check("auth_diagnostic_code_allowed", sql`${table.code} IN ('SESSION_EXPIRED', 'NO_STAFF_MATCH', 'STAFF_ACCESS_DISABLED', 'AUTH_SERVICE_UNAVAILABLE', 'STAFF_LOOKUP_TIMEOUT')`),
    check("auth_diagnostic_source_allowed", sql`${table.source} IN ('server', 'client')`),
  ]);

export const staffAccessChangesTable = pgTable("staff_access_changes", {
  id: serial("id").primaryKey(),
  actorStaffId: integer("actor_staff_id").notNull(),
  actorName: text("actor_name").notNull(),
  staffId: integer("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  action: text("action", { enum: ["CREATE", "UPDATE", "DELETE"] }).notNull(),
  beforeActive: boolean("before_active").notNull(),
  beforeLoginEnabled: boolean("before_login_enabled").notNull(),
  beforeFormerEmployee: boolean("before_former_employee").notNull(),
  beforeHasEmail: boolean("before_has_email").notNull(),
  afterActive: boolean("after_active").notNull(),
  afterLoginEnabled: boolean("after_login_enabled").notNull(),
  afterFormerEmployee: boolean("after_former_employee").notNull(),
  afterHasEmail: boolean("after_has_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});