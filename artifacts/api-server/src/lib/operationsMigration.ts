import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

// esbuild embeds the checked-in migration in production. Development reads
// that same file, so a deployment never depends on an external SQL asset.
declare const OPERATIONS_MIGRATION_SQL: string;
export async function applyOperationsMigration(
  database: Pick<typeof pool, "query"> = pool,
  environment = process.env.NODE_ENV,
) {
  // Replit-managed production schemas are applied by Publish, not by the
  // running application. Keep startup repeatable without production DDL.
  if (environment === "production") {
    const { rows } = await database.query<{ missing: string }>(`
      SELECT name AS missing
      FROM unnest(ARRAY[
        'time_entries', 'time_entry_audit', 'staff_badges', 'incidents',
        'supply_items', 'supply_requests', 'supply_movements',
        'area_checklists', 'inspections', 'monthly_reports',
        'operations_settings', 'operations_audit'
      ]) AS required(name)
      WHERE to_regclass('public.' || name) IS NULL
      UNION ALL
      SELECT 'tasks.photo_required'
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks'
          AND column_name = 'photo_required'
      )
    `);
    if (rows.length) {
      throw new Error(`Operations schema is missing ${rows.map(row => row.missing).join(", ")}. Publish with the additive development schema changes before starting production.`);
    }
    return;
  }
  const migration =
    typeof OPERATIONS_MIGRATION_SQL === "string"
      ? OPERATIONS_MIGRATION_SQL
      : await readFile(
          resolve(process.cwd(), "lib/db/migrations/20261005_operations.sql"),
          "utf8",
        ).catch(() =>
          readFile(
            resolve(
              process.cwd(),
              "../../lib/db/migrations/20261005_operations.sql",
            ),
            "utf8",
          ),
        );
  await database.query(migration);
}
