export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_conversation_id TEXT,
  subject TEXT NOT NULL,
  inspector_email TEXT NOT NULL,
  inspector_name TEXT,
  original_body TEXT NOT NULL,
  translated_body TEXT,
  translation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (translation_status IN ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  detected_location TEXT,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'OVERDUE', 'RESOLVED', 'ARCHIVED')),
  priority TEXT NOT NULL DEFAULT 'URGENT'
    CHECK (priority IN ('NORMAL', 'URGENT')),
  received_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  resolution_notes TEXT,
  assigned_supervisor_name TEXT,
  assigned_supervisor_email TEXT,
  escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status_due
  ON incidents (status, due_at);
CREATE INDEX IF NOT EXISTS idx_incidents_conversation
  ON incidents (external_conversation_id);
CREATE INDEX IF NOT EXISTS idx_incidents_received
  ON incidents (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_search
  ON incidents USING GIN (
    to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(inspector_email, '') || ' ' ||
      coalesce(original_body, '') || ' ' ||
      coalesce(translated_body, '') || ' ' ||
      coalesce(detected_location, '')
    )
  );

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  direction TEXT NOT NULL
    CHECK (direction IN ('INBOUND', 'OUTBOUND', 'SYSTEM')),
  provider_message_id TEXT UNIQUE,
  internet_message_id TEXT,
  sender_email TEXT,
  recipient_email TEXT,
  original_body TEXT NOT NULL,
  translated_body TEXT,
  translation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (translation_status IN ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_incident_created
  ON messages (incident_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  provider_attachment_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content BYTEA,
  is_inline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_incident
  ON attachments (incident_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_incident_created
  ON audit_logs (incident_id, created_at);

CREATE TABLE IF NOT EXISTS mail_sync_state (
  mailbox TEXT PRIMARY KEY,
  delta_link TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS graph_subscriptions (
  mailbox TEXT PRIMARY KEY,
  subscription_id TEXT UNIQUE NOT NULL,
  resource TEXT NOT NULL,
  client_state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
