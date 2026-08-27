import pg from "pg";
import { config } from "./config.js";
import { schemaSql } from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

export async function migrate(): Promise<void> {
  await pool.query(schemaSql);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
