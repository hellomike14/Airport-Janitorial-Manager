import { pgTable, text, serial, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffTable = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role", { enum: ["staff", "supervisor", "admin", "inspector"] }).notNull().default("staff"),
    phone: text("phone"),
    // Join key between the Clerk account and the staff record — must be
    // unique (case-insensitive) among active staff; see partial index below.
    email: text("email"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("staff_email_active_unique")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL AND ${t.email} != '' AND ${t.active} = true`),
  ],
);

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
