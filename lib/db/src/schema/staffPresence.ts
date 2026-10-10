import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const staffPresenceTable = pgTable("staff_presence", {
  staffId: integer("staff_id").primaryKey().references(() => staffTable.id),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});
