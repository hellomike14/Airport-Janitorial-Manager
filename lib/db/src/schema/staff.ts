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
    // Employment and authentication are deliberately separate.  In
    // particular, historic and notification-only rows must not become usable
    // just because a Clerk user has the same email address.
    loginEnabled: boolean("login_enabled").notNull().default(true),
    active: boolean("active").notNull().default(true),
    formerEmployee: boolean("former_employee").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("staff_login_email_unique")
      .on(sql`lower(btrim(${t.email}))`)
      .where(sql`${t.email} IS NOT NULL AND btrim(${t.email}) != '' AND ${t.active} = true AND ${t.loginEnabled} = true`),
  ],
);

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
