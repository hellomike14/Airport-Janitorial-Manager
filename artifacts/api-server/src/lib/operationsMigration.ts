import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

// esbuild embeds checked-in migrations in production. Development reads the
// same files, so a deployment never depends on external SQL assets.
declare const OPERATIONS_MIGRATION_SQL: string;

async function readMigration(fileName: string) {
  return readFile(resolve(process.cwd(), "lib/db/migrations", fileName), "utf8")
    .catch(() => readFile(resolve(process.cwd(), "../../lib/db/migrations", fileName), "utf8"));
}

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
        'operations_settings', 'operations_audit',
        'petty_cash_records', 'petty_cash_record_history',
        'petty_cash_expenses', 'petty_cash_receipt_uploads',
        'petty_cash_receipt_attachments', 'uniform_stock_items',
        'uniform_stock_transactions', 'uniform_stock_migration_runs',
        'uniform_stock_migration_audit', 'employment_form_submissions'
      ]) AS required(name)
      WHERE to_regclass('public.' || name) IS NULL
      UNION ALL
      SELECT 'tasks.photo_required'
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks'
          AND column_name = 'photo_required'
      )
      UNION ALL
      SELECT required.column_name
      FROM (VALUES
        ('petty_cash_records', 'minimum_reserve_cents'),
        ('petty_cash_records', 'target_float_cents'),
        ('petty_cash_records', 'reimbursement_paid_confirmed'),
        ('petty_cash_expenses', 'voucher_number'),
        ('petty_cash_expenses', 'receipt_attachment_id'),
        ('petty_cash_receipt_uploads', 'staging_path'),
        ('uniform_stock_items', 'reorder_level')
        ,('employment_form_submissions', 'review_status')
        ,('employment_form_submissions', 'reviewed_by_id')
        ,('employment_form_submissions', 'reviewed_at')
      ) AS required(table_name, column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = required.table_name
          AND column_name = required.column_name
      )
    `);
    if (rows.length) {
      throw new Error(`Operations schema is missing ${rows.map(row => row.missing).join(", ")}. Publish with the additive development schema changes before starting production.`);
    }
    return;
  }
  const migration = typeof OPERATIONS_MIGRATION_SQL === "string"
    ? OPERATIONS_MIGRATION_SQL
    : [
        await readMigration("20261005_operations.sql"),
        await readMigration("20261009_digital_operations.sql"),
        await readMigration("20261010_employee_form_review.sql"),
      ].join("\n");
  await database.query(migration);
}
