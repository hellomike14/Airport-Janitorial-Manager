import { pgTable, serial, integer, text, timestamp, date, doublePrecision, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staffTable } from "./staff";
import { areasTable } from "./areas";

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  workDate: date("work_date").notNull(),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  inLatitude: doublePrecision("in_latitude").notNull(),
  inLongitude: doublePrecision("in_longitude").notNull(),
  inAccuracy: doublePrecision("in_accuracy").notNull(),
  outLatitude: doublePrecision("out_latitude"),
  outLongitude: doublePrecision("out_longitude"),
  outAccuracy: doublePrecision("out_accuracy"),
  breakMinutes: integer("break_minutes").notNull().default(0),
  correctionReason: text("correction_reason"),
  approvedById: integer("approved_by_id").references(() => staffTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, t => [uniqueIndex("time_entries_one_open_per_staff").on(t.staffId).where(sql`${t.clockOut} IS NULL`)]);

export const timeEntryAuditTable = pgTable("time_entry_audit", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => timeEntriesTable.id),
  actorId: integer("actor_id").notNull().references(() => staffTable.id),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffBadgesTable = pgTable("staff_badges", {
  staffId: integer("staff_id").primaryKey().references(() => staffTable.id),
  badgeNumber: text("badge_number").notNull(),
  expiresOn: date("expires_on").notNull(),
  returnedOn: date("returned_on"),
  updatedById: integer("updated_by_id").notNull().references(() => staffTable.id),
});

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => areasTable.id),
  reportedById: integer("reported_by_id").notNull().references(() => staffTable.id),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  immediateAction: text("immediate_action").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  closedById: integer("closed_by_id").references(() => staffTable.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplyItemsTable = pgTable("supply_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  stock: integer("stock").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0),
});
export const supplyRequestsTable = pgTable("supply_requests", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => supplyItemsTable.id),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  quantity: integer("quantity").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  handledById: integer("handled_by_id").references(() => staffTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const supplyMovementsTable = pgTable("supply_movements", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => supplyItemsTable.id),
  actorId: integer("actor_id").notNull().references(() => staffTable.id),
  quantity: integer("quantity").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChecklistItem = { taskName: string; photoRequired: boolean };
export const areaChecklistsTable = pgTable("area_checklists", {
  areaId: integer("area_id").primaryKey().references(() => areasTable.id),
  items: jsonb("items").$type<ChecklistItem[]>().notNull(),
  updatedById: integer("updated_by_id").notNull().references(() => staffTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => areasTable.id),
  inspectedById: integer("inspected_by_id").notNull().references(() => staffTable.id),
  inspectionDate: date("inspection_date").notNull(),
  checks: jsonb("checks").$type<boolean[]>().notNull(),
  score: integer("score").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const monthlyReportsTable = pgTable("monthly_reports", {
  month: text("month").primaryKey(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operationsSettingsTable = pgTable("operations_settings", {
  id: integer("id").primaryKey().default(1),
  gpsRequired: boolean("gps_required").notNull().default(true),
  siteLatitude: doublePrecision("site_latitude").notNull().default(28.4312),
  siteLongitude: doublePrecision("site_longitude").notNull().default(-81.3081),
  radiusMeters: integer("radius_meters").notNull().default(5000),
  maxAccuracyMeters: integer("max_accuracy_meters").notNull().default(200),
});
