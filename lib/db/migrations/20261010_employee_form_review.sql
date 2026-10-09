ALTER TABLE employment_form_submissions
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

ALTER TABLE employment_form_submissions
  ADD COLUMN IF NOT EXISTS reviewed_by_id integer REFERENCES staff(id) ON DELETE SET NULL;

ALTER TABLE employment_form_submissions
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
