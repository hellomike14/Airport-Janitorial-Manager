-- Additive digital cash reconciliation and uniform stock tables.
-- No legacy workbook rows or balances are imported. Existing records are untouched.
BEGIN;
SELECT pg_advisory_xact_lock(8103, 2);

CREATE TABLE IF NOT EXISTS petty_cash_records (
  id serial PRIMARY KEY,
  location text NOT NULL,
  custodian_id integer NOT NULL REFERENCES staff(id),
  record_date date NOT NULL,
  opening_float_cents integer NOT NULL CHECK (opening_float_cents >= 0),
  opening_float_approved_by_id integer NOT NULL REFERENCES staff(id),
  opening_float_approved_at timestamptz NOT NULL DEFAULT now(),
  cash_on_hand_cents integer NOT NULL CHECK (cash_on_hand_cents >= 0),
  minimum_reserve_cents integer,
  target_float_cents integer,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  custodian_acknowledged_at timestamptz,
  custodian_acknowledged_recorded_by_id integer REFERENCES staff(id),
  manager_acknowledged_by_id integer REFERENCES staff(id),
  manager_acknowledged_at timestamptz,
  reimbursement_status text NOT NULL DEFAULT 'not_submitted'
    CHECK (reimbursement_status IN ('not_submitted', 'submitted', 'paid')),
  reimbursement_paid_confirmed boolean,
  reimbursement_amount_cents integer
    CHECK (reimbursement_amount_cents IS NULL OR reimbursement_amount_cents >= 0),
  reimbursement_reference text,
  reimbursement_submitted_on date,
  reimbursement_paid_on date,
  accounting_notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_id integer NOT NULL REFERENCES staff(id),
  updated_by_id integer NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'completed'
    OR (
      custodian_acknowledged_at IS NOT NULL
      AND manager_acknowledged_by_id IS NOT NULL
      AND manager_acknowledged_at IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS petty_cash_records_date_idx
  ON petty_cash_records(record_date, id);
CREATE INDEX IF NOT EXISTS petty_cash_records_custodian_idx
  ON petty_cash_records(custodian_id);

CREATE TABLE IF NOT EXISTS petty_cash_receipt_uploads (
  id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES staff(id),
  session_hash text NOT NULL,
  object_path text NOT NULL UNIQUE,
  staging_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'uploaded', 'attached')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS petty_cash_receipt_upload_actor_idx
  ON petty_cash_receipt_uploads(actor_id, created_at);

CREATE TABLE IF NOT EXISTS petty_cash_receipt_attachments (
  id uuid PRIMARY KEY REFERENCES petty_cash_receipt_uploads(id),
  record_id integer NOT NULL REFERENCES petty_cash_records(id),
  created_by_id integer NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_receipt_attachment_record_id_unique
  ON petty_cash_receipt_attachments(record_id, id);
CREATE INDEX IF NOT EXISTS petty_cash_receipt_attachment_record_idx
  ON petty_cash_receipt_attachments(record_id, created_at);

CREATE TABLE IF NOT EXISTS petty_cash_expenses (
  id serial PRIMARY KEY,
  record_id integer NOT NULL REFERENCES petty_cash_records(id),
  record_version integer NOT NULL CHECK (record_version >= 1),
  expense_date date NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  receipt_received boolean NOT NULL DEFAULT false,
  voucher_number text,
  receipt_attachment_id uuid
    CONSTRAINT petty_cash_expense_receipt_attachment_fk
    REFERENCES petty_cash_receipt_attachments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petty_cash_expenses_record_idx
  ON petty_cash_expenses(record_id, record_version, id);

ALTER TABLE petty_cash_records
  ADD COLUMN IF NOT EXISTS minimum_reserve_cents integer,
  ADD COLUMN IF NOT EXISTS target_float_cents integer,
  ADD COLUMN IF NOT EXISTS reimbursement_paid_confirmed boolean;
ALTER TABLE petty_cash_expenses
  ADD COLUMN IF NOT EXISTS voucher_number text,
  ADD COLUMN IF NOT EXISTS receipt_attachment_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'petty_cash_expense_receipt_attachment_fk'
  ) THEN
    ALTER TABLE petty_cash_expenses
      ADD CONSTRAINT petty_cash_expense_receipt_attachment_fk
      FOREIGN KEY (receipt_attachment_id) REFERENCES petty_cash_receipt_attachments(id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_paid_reference_unique
  ON petty_cash_records(lower(btrim(reimbursement_reference)))
  WHERE reimbursement_status = 'paid'
    AND reimbursement_reference IS NOT NULL
    AND btrim(reimbursement_reference) <> '';

CREATE TABLE IF NOT EXISTS petty_cash_record_history (
  id serial PRIMARY KEY,
  record_id integer NOT NULL REFERENCES petty_cash_records(id),
  actor_id integer NOT NULL REFERENCES staff(id),
  event text NOT NULL CHECK (event IN ('created', 'updated', 'completed')),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petty_cash_history_record_idx
  ON petty_cash_record_history(record_id, created_at, id);

CREATE TABLE IF NOT EXISTS uniform_stock_items (
  id serial PRIMARY KEY,
  item_code text,
  item_name text NOT NULL,
  description text,
  size text NOT NULL,
  current_quantity integer NOT NULL CHECK (current_quantity >= 0),
  reorder_level integer NOT NULL DEFAULT 6 CHECK (reorder_level >= 0),
  last_order_date date,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_id integer NOT NULL REFERENCES staff(id),
  updated_by_id integer NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniform_stock_items_name_size_active_unique
  ON uniform_stock_items(lower(item_name), lower(size))
  WHERE active = true;
CREATE INDEX IF NOT EXISTS uniform_stock_items_active_name_idx
  ON uniform_stock_items(active, item_name, size);

CREATE TABLE IF NOT EXISTS uniform_stock_transactions (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES uniform_stock_items(id),
  staff_id integer REFERENCES staff(id),
  actor_id integer NOT NULL REFERENCES staff(id),
  type text NOT NULL CHECK (
    type IN ('opening_balance', 'receipt', 'issue', 'return', 'adjustment')
  ),
  quantity integer NOT NULL CHECK (quantity >= 0),
  stock_delta integer NOT NULL,
  related_issue_id integer REFERENCES uniform_stock_transactions(id),
  condition_returned text CHECK (
    condition_returned IS NULL OR condition_returned IN ('serviceable', 'damaged')
  ),
  replacement_issued boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'return' AND related_issue_id IS NOT NULL AND staff_id IS NOT NULL)
    OR (type <> 'return' AND related_issue_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS uniform_stock_transactions_item_idx
  ON uniform_stock_transactions(item_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS uniform_stock_transactions_staff_idx
  ON uniform_stock_transactions(staff_id, occurred_at);
CREATE INDEX IF NOT EXISTS uniform_stock_transactions_issue_idx
  ON uniform_stock_transactions(related_issue_id);

ALTER TABLE uniform_stock_items
  ALTER COLUMN reorder_level SET DEFAULT 6;

CREATE TABLE IF NOT EXISTS uniform_stock_migration_runs (
  migration_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rows_updated integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS uniform_stock_migration_audit (
  id bigserial PRIMARY KEY,
  migration_key text NOT NULL REFERENCES uniform_stock_migration_runs(migration_key),
  item_id integer NOT NULL,
  item_name text NOT NULL,
  size text NOT NULL,
  previous_reorder_level integer NOT NULL,
  new_reorder_level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(migration_key, item_id)
);
DO $$
DECLARE
  first_apply boolean;
  updated_count integer;
BEGIN
  INSERT INTO uniform_stock_migration_runs(migration_key)
  VALUES ('uniform-reorder-level-six-v1')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  first_apply := updated_count = 1;
  IF first_apply THEN
    INSERT INTO uniform_stock_migration_audit(
      migration_key, item_id, item_name, size,
      previous_reorder_level, new_reorder_level
    )
    SELECT 'uniform-reorder-level-six-v1', id, item_name, size, reorder_level, 6
    FROM uniform_stock_items
    WHERE reorder_level <> 6;
    UPDATE uniform_stock_items SET reorder_level = 6
    WHERE reorder_level <> 6;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    UPDATE uniform_stock_migration_runs
      SET rows_updated = updated_count
      WHERE migration_key = 'uniform-reorder-level-six-v1';
  END IF;
END $$;

COMMIT;
