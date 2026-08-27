import type { QueryResultRow } from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";
import {
  GraphError,
  type GraphFileAttachment,
  type GraphMessage,
  createOrRenewSubscription,
  getMessageAttachments,
  getMessageDelta,
  graphConfigured,
  replyToMessage,
  sendMail,
} from "./graph.js";
import {
  type IncidentStatus,
  addMinutes,
  chooseSupervisor,
  detectLocation,
  firstNonEmpty,
  normalizeEmail,
  stripHtml,
  truncate,
} from "./core.js";
import { translate } from "./translation.js";

export interface IncidentRow extends QueryResultRow {
  id: string;
  external_conversation_id: string | null;
  subject: string;
  inspector_email: string;
  inspector_name: string | null;
  original_body: string;
  translated_body: string | null;
  translation_status: "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED";
  detected_location: string | null;
  status: IncidentStatus;
  priority: "NORMAL" | "URGENT";
  received_at: Date;
  due_at: Date;
  acknowledged_at: Date | null;
  started_at: Date | null;
  resolved_at: Date | null;
  archived_at: Date | null;
  resolution_notes: string | null;
  assigned_supervisor_name: string | null;
  assigned_supervisor_email: string | null;
  escalated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow extends QueryResultRow {
  id: string;
  incident_id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  provider_message_id: string | null;
  internet_message_id: string | null;
  sender_email: string | null;
  recipient_email: string | null;
  original_body: string;
  translated_body: string | null;
  translation_status: "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED";
  received_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
}

export interface AttachmentRow extends QueryResultRow {
  id: string;
  incident_id: string;
  message_id: string | null;
  provider_attachment_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  is_inline: boolean;
  created_at: Date;
}

export interface AuditRow extends QueryResultRow {
  id: string;
  incident_id: string | null;
  action: string;
  actor: string;
  details: Record<string, unknown> | null;
  created_at: Date;
}

export interface DashboardStats extends QueryResultRow {
  new_count: string;
  active_count: string;
  overdue_count: string;
  resolved_today_count: string;
}

export interface SyncStateRow extends QueryResultRow {
  mailbox: string;
  last_synced_at: Date | null;
  last_error: string | null;
  updated_at: Date;
}

interface IngestResult {
  created: boolean;
  incidentId: string;
}

function toDate(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function senderFromMessage(message: GraphMessage): {
  name: string | null;
  email: string;
} {
  const name = message.from?.emailAddress?.name?.trim() || null;
  const email = normalizeEmail(message.from?.emailAddress?.address ?? "unknown@invalid.local");
  return { name, email };
}

function attachmentBuffer(
  attachment: GraphFileAttachment,
): Buffer | null {
  if (!attachment.contentBytes) return null;
  const buffer = Buffer.from(attachment.contentBytes, "base64");
  return buffer.length <= config.attachmentMaxBytes ? buffer : null;
}

async function writeAudit(
  incidentId: string | null,
  action: string,
  actor: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (incident_id, action, actor, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [incidentId, action, actor, JSON.stringify(details)],
  );
}

async function notifySupervisor(
  incident: IncidentRow,
  kind: "new" | "follow-up" | "overdue",
): Promise<void> {
  if (!incident.assigned_supervisor_email || !graphConfigured()) return;

  const label =
    kind === "new"
      ? "NEW INSPECTOR REQUEST"
      : kind === "follow-up"
        ? "INSPECTOR FOLLOW-UP"
        : "OVERDUE INSPECTOR REQUEST";

  const body = [
    label,
    "",
    `Subject: ${incident.subject}`,
    `Inspector: ${incident.inspector_name ?? "Unknown"} <${incident.inspector_email}>`,
    `Location: ${incident.detected_location ?? "Not detected"}`,
    `Received: ${incident.received_at.toISOString()}`,
    `Internal deadline: ${incident.due_at.toISOString()}`,
    `Assigned to: ${incident.assigned_supervisor_name ?? "On-duty supervisor"}`,
    "",
    "Original English message:",
    incident.original_body,
    "",
    "Spanish translation:",
    incident.translated_body ?? incident.original_body,
    "",
    `Open request: ${config.appUrl}/incidents/${incident.id}`,
  ].join("\n");

  const recipients =
    kind === "overdue"
      ? [
          incident.assigned_supervisor_email,
          ...config.escalationEmails,
        ]
      : [incident.assigned_supervisor_email];

  try {
    await sendMail(recipients, `[${label}] ${truncate(incident.subject, 100)}`, body);
    await writeAudit(incident.id, "SUPERVISOR_ALERT_SENT", "system", {
      kind,
      recipients,
    });
  } catch (error) {
    await writeAudit(incident.id, "SUPERVISOR_ALERT_FAILED", "system", {
      kind,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

async function ingestMessage(message: GraphMessage): Promise<IngestResult | null> {
  if (!message.id || message["@removed"]) return null;

  const duplicate = await pool.query<{ id: string } & QueryResultRow>(
    "SELECT id FROM messages WHERE provider_message_id = $1 LIMIT 1",
    [message.id],
  );
  if (duplicate.rowCount) return null;

  const sender = senderFromMessage(message);
  if (
    config.microsoft.mailbox &&
    sender.email === normalizeEmail(config.microsoft.mailbox)
  ) {
    return null;
  }

  const receivedAt = toDate(message.receivedDateTime);
  const originalBody = stripHtml(
    firstNonEmpty(message.body?.content, message.bodyPreview, "(No message body)"),
  );
  const subject = firstNonEmpty(message.subject, "Inspector request");
  const translated = await translate(originalBody, "en", "es");
  const location = detectLocation(`${subject}\n${originalBody}`);
  const supervisor = chooseSupervisor(receivedAt, config.supervisors);

  let attachments: GraphFileAttachment[] = [];
  if (message.hasAttachments) {
    try {
      attachments = await getMessageAttachments(message.id);
    } catch (error) {
      console.error("Could not download message attachments", {
        messageId: message.id,
        error,
      });
    }
  }

  const client = await pool.connect();
  let incident: IncidentRow;
  let created = false;

  try {
    await client.query("BEGIN");

    const existing = message.conversationId
      ? await client.query<IncidentRow>(
          `SELECT *
           FROM incidents
           WHERE external_conversation_id = $1
             AND status NOT IN ('RESOLVED', 'ARCHIVED')
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [message.conversationId],
        )
      : { rows: [] as IncidentRow[], rowCount: 0 };

    if (existing.rowCount && existing.rows[0]) {
      incident = existing.rows[0];
      await client.query(
        `UPDATE incidents
         SET updated_at = NOW()
         WHERE id = $1`,
        [incident.id],
      );
    } else {
      const inserted = await client.query<IncidentRow>(
        `INSERT INTO incidents (
           external_conversation_id,
           subject,
           inspector_email,
           inspector_name,
           original_body,
           translated_body,
           translation_status,
           detected_location,
           status,
           priority,
           received_at,
           due_at,
           assigned_supervisor_name,
           assigned_supervisor_email
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW', 'URGENT', $9, $10, $11, $12)
         RETURNING *`,
        [
          message.conversationId ?? null,
          subject,
          sender.email,
          sender.name,
          originalBody,
          translated.text,
          translated.status,
          location,
          receivedAt,
          addMinutes(receivedAt, config.responseMinutes),
          supervisor.name,
          supervisor.email,
        ],
      );
      incident = inserted.rows[0] as IncidentRow;
      created = true;
    }

    const insertedMessage = await client.query<{ id: string } & QueryResultRow>(
      `INSERT INTO messages (
         incident_id,
         direction,
         provider_message_id,
         internet_message_id,
         sender_email,
         recipient_email,
         original_body,
         translated_body,
         translation_status,
         received_at
       )
       VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        incident.id,
        message.id,
        message.internetMessageId ?? null,
        sender.email,
        config.microsoft.mailbox ?? null,
        originalBody,
        translated.text,
        translated.status,
        receivedAt,
      ],
    );
    const messageId = insertedMessage.rows[0]?.id ?? null;

    for (const attachment of attachments) {
      const type = attachment["@odata.type"] ?? "";
      if (type && !type.endsWith("fileAttachment")) continue;

      const content = attachmentBuffer(attachment);
      await client.query(
        `INSERT INTO attachments (
           incident_id,
           message_id,
           provider_attachment_id,
           name,
           mime_type,
           size_bytes,
           content,
           is_inline
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          incident.id,
          messageId,
          attachment.id,
          attachment.name ?? "attachment",
          attachment.contentType ?? "application/octet-stream",
          attachment.size ?? content?.length ?? 0,
          content,
          attachment.isInline ?? false,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (incident_id, action, actor, details)
       VALUES ($1, $2, 'system', $3::jsonb)`,
      [
        incident.id,
        created ? "INSPECTOR_REQUEST_CREATED" : "INSPECTOR_FOLLOW_UP_RECEIVED",
        JSON.stringify({
          providerMessageId: message.id,
          conversationId: message.conversationId ?? null,
          translationProvider: translated.provider,
          attachmentCount: attachments.length,
          assignedSchedule: supervisor.schedule,
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const refreshed = await getIncident(incident.id);
  if (refreshed) {
    try {
      await notifySupervisor(refreshed.incident, created ? "new" : "follow-up");
    } catch (error) {
      console.error("Supervisor alert failed", error);
    }
  }

  return { created, incidentId: incident.id };
}

export async function syncMailbox(): Promise<{
  scanned: number;
  created: number;
  updated: number;
  deltaReset: boolean;
}> {
  if (!graphConfigured() || !config.microsoft.mailbox) {
    throw new Error("Microsoft Graph mailbox settings are incomplete.");
  }

  const mailbox = normalizeEmail(config.microsoft.mailbox);
  const state = await pool.query<
    { delta_link: string | null } & QueryResultRow
  >("SELECT delta_link FROM mail_sync_state WHERE mailbox = $1", [mailbox]);

  let deltaLink = state.rows[0]?.delta_link ?? null;
  let deltaReset = false;
  let result: Awaited<ReturnType<typeof getMessageDelta>>;

  try {
    result = await getMessageDelta(deltaLink);
  } catch (error) {
    if (error instanceof GraphError && error.status === 410 && deltaLink) {
      deltaLink = null;
      deltaReset = true;
      result = await getMessageDelta(null);
    } else {
      await pool.query(
        `INSERT INTO mail_sync_state (mailbox, last_error, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (mailbox)
         DO UPDATE SET last_error = EXCLUDED.last_error, updated_at = NOW()`,
        [mailbox, error instanceof Error ? error.message : "Unknown sync error"],
      );
      throw error;
    }
  }

  let created = 0;
  let updated = 0;

  const sorted = [...result.messages].sort((left, right) =>
    (left.receivedDateTime ?? "").localeCompare(right.receivedDateTime ?? ""),
  );

  for (const message of sorted) {
    const ingested = await ingestMessage(message);
    if (!ingested) continue;
    if (ingested.created) created += 1;
    else updated += 1;
  }

  await pool.query(
    `INSERT INTO mail_sync_state (
       mailbox, delta_link, last_synced_at, last_error, updated_at
     )
     VALUES ($1, $2, NOW(), NULL, NOW())
     ON CONFLICT (mailbox)
     DO UPDATE SET
       delta_link = EXCLUDED.delta_link,
       last_synced_at = NOW(),
       last_error = NULL,
       updated_at = NOW()`,
    [mailbox, result.deltaLink],
  );

  return {
    scanned: result.messages.length,
    created,
    updated,
    deltaReset,
  };
}

export async function escalateOverdue(): Promise<{ escalated: number }> {
  const overdue = await pool.query<IncidentRow>(
    `UPDATE incidents
     SET status = 'OVERDUE',
         escalated_at = NOW(),
         updated_at = NOW()
     WHERE due_at <= NOW()
       AND status NOT IN ('RESOLVED', 'ARCHIVED', 'OVERDUE')
       AND escalated_at IS NULL
     RETURNING *`,
  );

  for (const incident of overdue.rows) {
    await writeAudit(incident.id, "INCIDENT_OVERDUE", "system", {
      dueAt: incident.due_at.toISOString(),
    });

    try {
      await notifySupervisor(incident, "overdue");
    } catch (error) {
      console.error("Overdue escalation email failed", {
        incidentId: incident.id,
        error,
      });
    }
  }

  return { escalated: overdue.rowCount ?? 0 };
}

export async function renewGraphSubscription(): Promise<{
  changed: boolean;
  expiresAt: string | null;
}> {
  if (!config.microsoft.mailbox) {
    throw new Error("MICROSOFT_MAILBOX is not configured.");
  }

  const mailbox = normalizeEmail(config.microsoft.mailbox);
  const existing = await pool.query<
    {
      subscription_id: string;
      expires_at: Date;
    } & QueryResultRow
  >(
    `SELECT subscription_id, expires_at
     FROM graph_subscriptions
     WHERE mailbox = $1`,
    [mailbox],
  );

  const current = existing.rows[0];
  if (current && current.expires_at.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { changed: false, expiresAt: current.expires_at.toISOString() };
  }

  let subscription;
  try {
    subscription = await createOrRenewSubscription(current?.subscription_id);
  } catch (error) {
    if (current && error instanceof GraphError && error.status === 404) {
      subscription = await createOrRenewSubscription();
    } else {
      throw error;
    }
  }

  await pool.query(
    `INSERT INTO graph_subscriptions (
       mailbox, subscription_id, resource, client_state, expires_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (mailbox)
     DO UPDATE SET
       subscription_id = EXCLUDED.subscription_id,
       resource = EXCLUDED.resource,
       client_state = EXCLUDED.client_state,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      mailbox,
      subscription.id,
      subscription.resource,
      config.microsoft.webhookClientState,
      new Date(subscription.expirationDateTime),
    ],
  );

  return { changed: true, expiresAt: subscription.expirationDateTime };
}

export async function listIncidents(options: {
  status?: string;
  query?: string;
  limit?: number;
}): Promise<IncidentRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const allowedStatuses = new Set<IncidentStatus>([
    "NEW",
    "ACKNOWLEDGED",
    "IN_PROGRESS",
    "OVERDUE",
    "RESOLVED",
    "ARCHIVED",
  ]);

  if (options.status && allowedStatuses.has(options.status as IncidentStatus)) {
    values.push(options.status);
    conditions.push(`status = $${values.length}`);
  } else if (!options.status || options.status === "open") {
    conditions.push(`status NOT IN ('RESOLVED', 'ARCHIVED')`);
  }

  if (options.query?.trim()) {
    values.push(options.query.trim());
    conditions.push(
      `to_tsvector(
         'simple',
         coalesce(subject, '') || ' ' ||
         coalesce(inspector_email, '') || ' ' ||
         coalesce(original_body, '') || ' ' ||
         coalesce(translated_body, '') || ' ' ||
         coalesce(detected_location, '')
       ) @@ plainto_tsquery('simple', $${values.length})`,
    );
  }

  values.push(Math.min(Math.max(options.limit ?? 100, 1), 250));

  const result = await pool.query<IncidentRow>(
    `SELECT *
     FROM incidents
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY
       CASE status
         WHEN 'OVERDUE' THEN 0
         WHEN 'NEW' THEN 1
         WHEN 'ACKNOWLEDGED' THEN 2
         WHEN 'IN_PROGRESS' THEN 3
         WHEN 'RESOLVED' THEN 4
         ELSE 5
       END,
       due_at ASC,
       received_at DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const result = await pool.query<DashboardStats>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'NEW')::text AS new_count,
       COUNT(*) FILTER (
         WHERE status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'OVERDUE')
       )::text AS active_count,
       COUNT(*) FILTER (WHERE status = 'OVERDUE')::text AS overdue_count,
       COUNT(*) FILTER (
         WHERE status = 'RESOLVED'
           AND resolved_at >= date_trunc('day', NOW())
       )::text AS resolved_today_count
     FROM incidents`,
  );

  return (
    result.rows[0] ?? {
      new_count: "0",
      active_count: "0",
      overdue_count: "0",
      resolved_today_count: "0",
    }
  );
}

export async function getSyncState(): Promise<SyncStateRow | null> {
  if (!config.microsoft.mailbox) return null;
  const result = await pool.query<SyncStateRow>(
    `SELECT mailbox, last_synced_at, last_error, updated_at
     FROM mail_sync_state
     WHERE mailbox = $1`,
    [normalizeEmail(config.microsoft.mailbox)],
  );
  return result.rows[0] ?? null;
}

export async function getIncident(id: string): Promise<{
  incident: IncidentRow;
  messages: MessageRow[];
  attachments: AttachmentRow[];
  audits: AuditRow[];
} | null> {
  const incidentResult = await pool.query<IncidentRow>(
    "SELECT * FROM incidents WHERE id = $1",
    [id],
  );
  const incident = incidentResult.rows[0];
  if (!incident) return null;

  const [messages, attachments, audits] = await Promise.all([
    pool.query<MessageRow>(
      "SELECT * FROM messages WHERE incident_id = $1 ORDER BY created_at ASC",
      [id],
    ),
    pool.query<AttachmentRow>(
      `SELECT id, incident_id, message_id, provider_attachment_id, name,
              mime_type, size_bytes, is_inline, created_at
       FROM attachments
       WHERE incident_id = $1
       ORDER BY created_at ASC`,
      [id],
    ),
    pool.query<AuditRow>(
      "SELECT * FROM audit_logs WHERE incident_id = $1 ORDER BY created_at DESC",
      [id],
    ),
  ]);

  return {
    incident,
    messages: messages.rows,
    attachments: attachments.rows,
    audits: audits.rows,
  };
}

export async function getAttachment(id: string): Promise<{
  name: string;
  mimeType: string;
  content: Buffer | null;
} | null> {
  const result = await pool.query<
    { name: string; mime_type: string; content: Buffer | null } & QueryResultRow
  >(
    "SELECT name, mime_type, content FROM attachments WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  return row
    ? { name: row.name, mimeType: row.mime_type, content: row.content }
    : null;
}

export async function acknowledgeIncident(
  id: string,
  actor: string,
): Promise<void> {
  await pool.query(
    `UPDATE incidents
     SET status = CASE WHEN status = 'NEW' THEN 'ACKNOWLEDGED' ELSE status END,
         acknowledged_at = COALESCE(acknowledged_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND status NOT IN ('RESOLVED', 'ARCHIVED')`,
    [id],
  );
  await writeAudit(id, "INCIDENT_ACKNOWLEDGED", actor);
}

export async function startIncident(
  id: string,
  actor: string,
): Promise<void> {
  await pool.query(
    `UPDATE incidents
     SET status = CASE
           WHEN status IN ('NEW', 'ACKNOWLEDGED') THEN 'IN_PROGRESS'
           ELSE status
         END,
         acknowledged_at = COALESCE(acknowledged_at, NOW()),
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND status NOT IN ('RESOLVED', 'ARCHIVED')`,
    [id],
  );
  await writeAudit(id, "WORK_STARTED", actor);
}

async function latestInboundMessageId(incidentId: string): Promise<string | null> {
  const result = await pool.query<
    { provider_message_id: string | null } & QueryResultRow
  >(
    `SELECT provider_message_id
     FROM messages
     WHERE incident_id = $1
       AND direction = 'INBOUND'
       AND provider_message_id IS NOT NULL
     ORDER BY received_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [incidentId],
  );
  return result.rows[0]?.provider_message_id ?? null;
}

export async function replyToInspector(
  id: string,
  spanishBody: string,
  actor: string,
): Promise<void> {
  const bundle = await getIncident(id);
  if (!bundle) throw new Error("Incident not found.");
  if (["RESOLVED", "ARCHIVED"].includes(bundle.incident.status)) {
    throw new Error("Closed incidents cannot receive a new reply.");
  }

  const cleanBody = spanishBody.trim();
  if (!cleanBody) throw new Error("Reply text is required.");

  const providerMessageId = await latestInboundMessageId(id);
  if (!providerMessageId) {
    throw new Error("No inbound Microsoft message is available to reply to.");
  }

  const translated = await translate(cleanBody, "es", "en");
  await replyToMessage(providerMessageId, translated.text);

  await pool.query(
    `INSERT INTO messages (
       incident_id,
       direction,
       sender_email,
       recipient_email,
       original_body,
       translated_body,
       translation_status,
       sent_at
     )
     VALUES ($1, 'OUTBOUND', $2, $3, $4, $5, $6, NOW())`,
    [
      id,
      config.microsoft.mailbox ?? null,
      bundle.incident.inspector_email,
      cleanBody,
      translated.text,
      translated.status,
    ],
  );

  await pool.query(
    `UPDATE incidents
     SET status = 'IN_PROGRESS',
         acknowledged_at = COALESCE(acknowledged_at, NOW()),
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [id],
  );

  await writeAudit(id, "REPLY_SENT_TO_INSPECTOR", actor, {
    translationProvider: translated.provider,
    translationStatus: translated.status,
  });
}

export async function resolveIncident(
  id: string,
  options: {
    notesSpanish: string;
    actor: string;
    notifyInspector: boolean;
    completionPhoto?: {
      name: string;
      mimeType: string;
      size: number;
      buffer: Buffer;
    };
  },
): Promise<void> {
  const bundle = await getIncident(id);
  if (!bundle) throw new Error("Incident not found.");

  const notes = options.notesSpanish.trim();
  let translated: Awaited<ReturnType<typeof translate>> | null = null;

  if (options.notifyInspector && notes) {
    const providerMessageId = await latestInboundMessageId(id);
    if (providerMessageId) {
      translated = await translate(notes, "es", "en");
      await replyToMessage(
        providerMessageId,
        `Resolved.\n\n${translated.text}`,
      );

      await pool.query(
        `INSERT INTO messages (
           incident_id,
           direction,
           sender_email,
           recipient_email,
           original_body,
           translated_body,
           translation_status,
           sent_at
         )
         VALUES ($1, 'OUTBOUND', $2, $3, $4, $5, $6, NOW())`,
        [
          id,
          config.microsoft.mailbox ?? null,
          bundle.incident.inspector_email,
          notes,
          translated.text,
          translated.status,
        ],
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE incidents
       SET status = 'RESOLVED',
           resolution_notes = $2,
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [id, notes || null],
    );

    if (options.completionPhoto) {
      await client.query(
        `INSERT INTO attachments (
           incident_id, name, mime_type, size_bytes, content, is_inline
         )
         VALUES ($1, $2, $3, $4, $5, FALSE)`,
        [
          id,
          options.completionPhoto.name,
          options.completionPhoto.mimeType,
          options.completionPhoto.size,
          options.completionPhoto.buffer,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (incident_id, action, actor, details)
       VALUES ($1, 'INCIDENT_RESOLVED', $2, $3::jsonb)`,
      [
        id,
        options.actor,
        JSON.stringify({
          inspectorNotified: options.notifyInspector,
          completionPhoto: Boolean(options.completionPhoto),
          translationProvider: translated?.provider ?? null,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveIncident(
  id: string,
  actor: string,
): Promise<void> {
  await pool.query(
    `UPDATE incidents
     SET status = 'ARCHIVED',
         archived_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'RESOLVED'`,
    [id],
  );
  await writeAudit(id, "INCIDENT_ARCHIVED", actor);
}
