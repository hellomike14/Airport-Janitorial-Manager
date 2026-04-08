import { pgTable, text, serial, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { areasTable } from "./areas";

export const sharedPhotosTable = pgTable("shared_photos", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  imagePath: text("image_path").notNull(),
  caption: text("caption"),
  areaId: integer("area_id").references(() => areasTable.id),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  takenAt: timestamp("taken_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SharedPhoto = typeof sharedPhotosTable.$inferSelect;
