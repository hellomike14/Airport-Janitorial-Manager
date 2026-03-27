import { pgTable, serial, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const staffLocationsTable = pgTable("staff_locations", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracy: doublePrecision("accuracy"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type StaffLocation = typeof staffLocationsTable.$inferSelect;
