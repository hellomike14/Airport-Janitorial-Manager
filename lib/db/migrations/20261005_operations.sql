-- Additive migration. Does not delete or merge existing operational records.
BEGIN;
SELECT pg_advisory_xact_lock(8103, 1);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS time_entries (
  id serial PRIMARY KEY, staff_id integer NOT NULL REFERENCES staff(id), work_date date NOT NULL,
  clock_in timestamptz NOT NULL, clock_out timestamptz,
  in_latitude double precision NOT NULL, in_longitude double precision NOT NULL, in_accuracy double precision NOT NULL,
  out_latitude double precision, out_longitude double precision, out_accuracy double precision,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0), correction_reason text,
  approved_by_id integer REFERENCES staff(id), approved_at timestamptz,
  CHECK (clock_out IS NULL OR clock_out > clock_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_per_staff ON time_entries(staff_id) WHERE clock_out IS NULL;
CREATE TABLE IF NOT EXISTS time_entry_audit (
  id serial PRIMARY KEY, entry_id integer NOT NULL REFERENCES time_entries(id), actor_id integer NOT NULL REFERENCES staff(id),
  action text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_badges (
  staff_id integer PRIMARY KEY REFERENCES staff(id), badge_number text NOT NULL, expires_on date NOT NULL,
  returned_on date, updated_by_id integer NOT NULL REFERENCES staff(id)
);
CREATE TABLE IF NOT EXISTS incidents (
  id serial PRIMARY KEY, area_id integer NOT NULL REFERENCES areas(id), reported_by_id integer NOT NULL REFERENCES staff(id),
  category text NOT NULL, severity text NOT NULL, description text NOT NULL, immediate_action text NOT NULL,
  occurred_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'open', resolution text,
  closed_by_id integer REFERENCES staff(id), closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supply_items (
  id serial PRIMARY KEY, name text NOT NULL, unit text NOT NULL,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0), reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0)
);
CREATE TABLE IF NOT EXISTS supply_requests (
  id serial PRIMARY KEY, item_id integer NOT NULL REFERENCES supply_items(id), staff_id integer NOT NULL REFERENCES staff(id),
  quantity integer NOT NULL CHECK (quantity > 0), notes text, status text NOT NULL DEFAULT 'pending',
  handled_by_id integer REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supply_movements (
  id serial PRIMARY KEY, item_id integer NOT NULL REFERENCES supply_items(id), actor_id integer NOT NULL REFERENCES staff(id),
  quantity integer NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS area_checklists (
  area_id integer PRIMARY KEY REFERENCES areas(id), items jsonb NOT NULL,
  updated_by_id integer NOT NULL REFERENCES staff(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inspections (
  id serial PRIMARY KEY, area_id integer NOT NULL REFERENCES areas(id), inspected_by_id integer NOT NULL REFERENCES staff(id),
  inspection_date date NOT NULL, checks jsonb NOT NULL, score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monthly_reports (
  month text PRIMARY KEY, report jsonb NOT NULL, generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), gps_required boolean NOT NULL DEFAULT true,
  site_latitude double precision NOT NULL DEFAULT 28.4312, site_longitude double precision NOT NULL DEFAULT -81.3081,
  radius_meters integer NOT NULL DEFAULT 5000, max_accuracy_meters integer NOT NULL DEFAULT 200
);
INSERT INTO operations_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS operations_audit (
  id serial PRIMARY KEY, actor_id integer NOT NULL REFERENCES staff(id), action text NOT NULL,
  details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
