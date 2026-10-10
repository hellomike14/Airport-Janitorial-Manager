BEGIN;
CREATE TABLE IF NOT EXISTS staff_presence (
  staff_id integer PRIMARY KEY REFERENCES staff(id),
  last_seen_at timestamptz NOT NULL
);
COMMIT;
