import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

// esbuild embeds the checked-in migration in production. Development reads
// that same file, so a deployment never depends on an external SQL asset.
declare const OPERATIONS_MIGRATION_SQL: string;
export async function applyOperationsMigration() {
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
  await pool.query(migration);
}
