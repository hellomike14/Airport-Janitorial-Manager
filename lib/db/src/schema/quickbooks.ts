import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const quickbooksConnectionsTable = pgTable("quickbooks_connections", {
  id: serial("id").primaryKey(),
  realmId: text("realm_id"),
  companyName: text("company_name"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  status: text("status", { enum: ["connected", "disconnected"] })
    .notNull()
    .default("disconnected"),
  connectedAt: timestamp("connected_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuickbooksConnection = typeof quickbooksConnectionsTable.$inferSelect;
