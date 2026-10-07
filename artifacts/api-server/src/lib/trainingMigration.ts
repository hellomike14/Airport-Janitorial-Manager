import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";

export async function applyTrainingMigration(database: Pick<typeof pool, "query"> = pool,
  environment = process.env.NODE_ENV) {
  if (environment === "production") {
    const { rows } = await database.query(`
      SELECT name FROM unnest(ARRAY['training_progress', 'training_acknowledgments']) AS required(name)
      WHERE to_regclass('public.' || name) IS NULL`);
    if (rows.length) throw new Error("Employee training schema missing. Publish the additive schema changes before starting production.");
    return;
  }
  const migration = await readFile(resolve(process.cwd(), "lib/db/migrations/20261006_employee_training.sql"), "utf8")
    .catch(() => readFile(resolve(process.cwd(), "../../lib/db/migrations/20261006_employee_training.sql"), "utf8"));
  await database.query(migration);
}
