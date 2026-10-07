CREATE TABLE IF NOT EXISTS training_progress (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  version TEXT NOT NULL,
  watched_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  session_id TEXT,
  last_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  was_playing BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_progress_staff_version_unique ON training_progress(staff_id, version);
CREATE TABLE IF NOT EXISTS training_acknowledgments (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  version TEXT NOT NULL,
  training_title TEXT NOT NULL,
  video_sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  watched_confirmation BOOLEAN NOT NULL,
  understood_confirmation BOOLEAN NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_acknowledgments_staff_version_unique ON training_acknowledgments(staff_id, version);
