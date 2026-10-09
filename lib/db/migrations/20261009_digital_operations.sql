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
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  custodian_acknowledged_at timestamptz,
  custodian_acknowledged_recorded_by_id integer REFERENCES staff(id),
  manager_acknowledged_by_id integer REFERENCES staff(id),
  manager_acknowledged_at timestamptz,
  reimbursement_status text NOT NULL DEFAULT 'not_submitted'
    CHECK (reimbursement_status IN ('not_submitted', 'submitted', 'paid')),
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

CREATE TABLE IF NOT EXISTS petty_cash_expenses (
  id serial PRIMARY KEY,
  record_id integer NOT NULL REFERENCES petty_cash_records(id),
  record_version integer NOT NULL CHECK (record_version >= 1),
  expense_date date NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  receipt_received boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petty_cash_expenses_record_idx
  ON petty_cash_expenses(record_id, record_version, id);

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
  reorder_level integer NOT NULL CHECK (reorder_level >= 0),
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

COMMIT;
