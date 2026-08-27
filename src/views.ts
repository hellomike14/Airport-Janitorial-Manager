import { config } from "./config.js";
import { escapeHtml, truncate } from "./core.js";
import type {
  AttachmentRow,
  AuditRow,
  DashboardStats,
  IncidentRow,
  MessageRow,
  SyncStateRow,
} from "./operations.js";

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function layout(
  title: string,
  body: string,
  options: { csrf?: string; refreshSeconds?: number } = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : ""}
  <title>${escapeHtml(title)} · Airport Janitorial Manager</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/dashboard">
      <span class="brand-mark">AJ</span>
      <span>
        <strong>Airport Janitorial Manager</strong>
        <small>Inspector Response Desk</small>
      </span>
    </a>
    ${
      options.csrf
        ? `<form method="post" action="/logout">
             <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
             <button class="button button-quiet" type="submit">Sign out</button>
           </form>`
        : ""
    }
  </header>
  <main class="page-shell">
    ${body}
  </main>
</body>
</html>`;
}

function statusPill(status: string): string {
  const label = status.replaceAll("_", " ");
  return `<span class="status status-${escapeHtml(status.toLowerCase())}">${escapeHtml(label)}</span>`;
}

function metric(label: string, value: string, href: string, tone = ""): string {
  return `<a class="metric ${tone}" href="${href}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  </a>`;
}

function syncMessage(sync: SyncStateRow | null): string {
  if (!config.microsoft.mailbox) {
    return `<div class="notice notice-warning">
      Microsoft mailbox settings are not configured. The dashboard works, but email intake is off.
    </div>`;
  }

  if (!sync) {
    return `<div class="notice">
      Mailbox ready for its first sync: ${escapeHtml(config.microsoft.mailbox)}
    </div>`;
  }

  if (sync.last_error) {
    return `<div class="notice notice-danger">
      Last mailbox error: ${escapeHtml(sync.last_error)}
    </div>`;
  }

  return `<div class="notice notice-success">
    Mailbox synced ${escapeHtml(formatDate(sync.last_synced_at))}
  </div>`;
}

export function renderLogin(error?: string, next = "/dashboard"): string {
  return layout(
    "Sign in",
    `<section class="login-panel">
      <div>
        <p class="eyebrow">Operations access</p>
        <h1>Inspector response dashboard</h1>
        <p class="lede">
          Review incoming airport inspection requests, respond in Spanish, track the 15-minute deadline, and close each issue with proof.
        </p>
      </div>
      <form class="card login-card" method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label>
          Operations password
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
        <button class="button button-primary" type="submit">Open dashboard</button>
      </form>
    </section>`,
  );
}

export function renderDashboard(options: {
  csrf: string;
  incidents: IncidentRow[];
  stats: DashboardStats;
  sync: SyncStateRow | null;
  status?: string;
  query?: string;
  message?: string;
}): string {
  const cards = options.incidents
    .map(
      (incident) => `<a class="incident-card" href="/incidents/${incident.id}">
        <div class="incident-card-top">
          ${statusPill(incident.status)}
          <time data-due="${incident.due_at.toISOString()}">
            Due ${escapeHtml(formatDate(incident.due_at))}
          </time>
        </div>
        <h2>${escapeHtml(incident.subject)}</h2>
        <p class="incident-location">${escapeHtml(incident.detected_location ?? "Location not detected")}</p>
        <p>${escapeHtml(truncate(incident.translated_body ?? incident.original_body, 220))}</p>
        <div class="incident-meta">
          <span>${escapeHtml(incident.inspector_name ?? incident.inspector_email)}</span>
          <span>${escapeHtml(incident.assigned_supervisor_name ?? "Unassigned")}</span>
          <span>${escapeHtml(formatDate(incident.received_at))}</span>
        </div>
      </a>`,
    )
    .join("");

  const body = `
    <section class="page-heading">
      <div>
        <p class="eyebrow">Live operations</p>
        <h1>Inspector requests</h1>
        <p class="lede">Inspectors stay in email. Supervisors manage every request here.</p>
      </div>
      <div class="heading-actions">
        <form method="post" action="/operations/sync">
          <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
          <button class="button button-secondary" type="submit">Sync mailbox now</button>
        </form>
        <form method="post" action="/operations/subscription">
          <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
          <button class="button button-quiet" type="submit">Refresh webhook</button>
        </form>
      </div>
    </section>

    ${options.message ? `<div class="notice notice-success">${escapeHtml(options.message)}</div>` : ""}
    ${syncMessage(options.sync)}

    <section class="metrics-grid">
      ${metric("New", options.stats.new_count, "/dashboard?status=NEW")}
      ${metric("Active", options.stats.active_count, "/dashboard?status=open")}
      ${metric("Overdue", options.stats.overdue_count, "/dashboard?status=OVERDUE", "metric-danger")}
      ${metric("Resolved today", options.stats.resolved_today_count, "/dashboard?status=RESOLVED")}
    </section>

    <section class="toolbar card">
      <form method="get" action="/dashboard" class="search-form">
        <label class="sr-only" for="q">Search requests</label>
        <input id="q" name="q" type="search" value="${escapeHtml(options.query ?? "")}" placeholder="Search inspector, location, or message">
        <select name="status" aria-label="Status">
          ${[
            ["open", "Open requests"],
            ["NEW", "New"],
            ["ACKNOWLEDGED", "Acknowledged"],
            ["IN_PROGRESS", "In progress"],
            ["OVERDUE", "Overdue"],
            ["RESOLVED", "Resolved"],
            ["ARCHIVED", "Archived"],
            ["all", "All"],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${options.status === value ? "selected" : ""}>${label}</option>`,
            )
            .join("")}
        </select>
        <button class="button button-secondary" type="submit">Filter</button>
      </form>
    </section>

    <section class="incident-list" aria-live="polite">
      ${cards || `<div class="empty-state card"><h2>No matching requests</h2><p>New inspector emails will appear here after mailbox sync.</p></div>`}
    </section>
  `;

  return layout("Dashboard", body, {
    csrf: options.csrf,
    refreshSeconds: 30,
  });
}

function attachmentList(attachments: AttachmentRow[]): string {
  if (!attachments.length) return "<p>No attachments.</p>";

  return `<ul class="attachment-list">
    ${attachments
      .map(
        (attachment) => `<li>
          <a href="/attachments/${attachment.id}">
            ${escapeHtml(attachment.name)}
          </a>
          <span>${Math.ceil(attachment.size_bytes / 1024)} KB</span>
          ${attachment.is_inline ? "<small>Inline image</small>" : ""}
        </li>`,
      )
      .join("")}
  </ul>`;
}

function messageTimeline(messages: MessageRow[]): string {
  return messages
    .map((message) => {
      const inbound = message.direction === "INBOUND";
      const primary = inbound
        ? message.translated_body ?? message.original_body
        : message.original_body;
      const secondary = inbound
        ? message.original_body
        : message.translated_body;

      return `<article class="timeline-item timeline-${message.direction.toLowerCase()}">
        <div class="timeline-dot"></div>
        <div class="timeline-card">
          <div class="timeline-head">
            <strong>${inbound ? "Inspector → Operations" : "Operations → Inspector"}</strong>
            <time>${escapeHtml(formatDate(message.received_at ?? message.sent_at ?? message.created_at))}</time>
          </div>
          <p class="message-primary">${escapeHtml(primary)}</p>
          ${
            secondary && secondary !== primary
              ? `<details>
                   <summary>${inbound ? "View original English" : "View English sent"}</summary>
                   <p>${escapeHtml(secondary)}</p>
                 </details>`
              : ""
          }
        </div>
      </article>`;
    })
    .join("");
}

function auditList(audits: AuditRow[]): string {
  return audits
    .slice(0, 20)
    .map(
      (audit) => `<li>
        <strong>${escapeHtml(audit.action.replaceAll("_", " "))}</strong>
        <span>${escapeHtml(audit.actor)} · ${escapeHtml(formatDate(audit.created_at))}</span>
      </li>`,
    )
    .join("");
}

export function renderIncident(options: {
  csrf: string;
  incident: IncidentRow;
  messages: MessageRow[];
  attachments: AttachmentRow[];
  audits: AuditRow[];
  error?: string;
  message?: string;
}): string {
  const incident = options.incident;
  const isClosed = ["RESOLVED", "ARCHIVED"].includes(incident.status);

  const body = `
    <p><a class="back-link" href="/dashboard">← Back to requests</a></p>

    ${options.error ? `<div class="notice notice-danger">${escapeHtml(options.error)}</div>` : ""}
    ${options.message ? `<div class="notice notice-success">${escapeHtml(options.message)}</div>` : ""}

    <section class="incident-heading">
      <div>
        <div class="heading-status">${statusPill(incident.status)}</div>
        <h1>${escapeHtml(incident.subject)}</h1>
        <p class="lede">${escapeHtml(incident.detected_location ?? "Location not detected from the email")}</p>
      </div>
      <div class="deadline-card">
        <span>Internal deadline</span>
        <strong data-due="${incident.due_at.toISOString()}">${escapeHtml(formatDate(incident.due_at))}</strong>
        <small>Airport allowance may be longer; internal target is ${config.responseMinutes} minutes.</small>
      </div>
    </section>

    <section class="details-grid">
      <div class="card detail-card">
        <span>Inspector</span>
        <strong>${escapeHtml(incident.inspector_name ?? "Unknown")}</strong>
        <a href="mailto:${escapeHtml(incident.inspector_email)}">${escapeHtml(incident.inspector_email)}</a>
      </div>
      <div class="card detail-card">
        <span>Assigned supervisor</span>
        <strong>${escapeHtml(incident.assigned_supervisor_name ?? "Unassigned")}</strong>
        <small>${escapeHtml(incident.assigned_supervisor_email ?? "")}</small>
      </div>
      <div class="card detail-card">
        <span>Received</span>
        <strong>${escapeHtml(formatDate(incident.received_at))}</strong>
        <small>${incident.acknowledged_at ? `Acknowledged ${escapeHtml(formatDate(incident.acknowledged_at))}` : "Not acknowledged"}</small>
      </div>
    </section>

    <section class="translation-grid">
      <article class="card message-panel">
        <p class="panel-label">Original English</p>
        <h2>Inspector message</h2>
        <p>${escapeHtml(incident.original_body)}</p>
      </article>
      <article class="card message-panel message-panel-highlight">
        <p class="panel-label">Spanish translation · ${escapeHtml(incident.translation_status)}</p>
        <h2>Mensaje para el supervisor</h2>
        <p>${escapeHtml(incident.translated_body ?? incident.original_body)}</p>
      </article>
    </section>

    <section class="work-grid">
      <div>
        <section class="card section-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Conversation</p>
              <h2>Request timeline</h2>
            </div>
          </div>
          <div class="timeline">
            ${messageTimeline(options.messages)}
          </div>
        </section>

        <section class="card section-card">
          <p class="eyebrow">Evidence</p>
          <h2>Photos and attachments</h2>
          ${attachmentList(options.attachments)}
        </section>
      </div>

      <aside class="action-column">
        ${
          !isClosed
            ? `<section class="card action-card">
                <p class="eyebrow">Status</p>
                <h2>Take ownership</h2>
                <div class="button-stack">
                  <form method="post" action="/incidents/${incident.id}/acknowledge">
                    <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
                    <button class="button button-secondary" type="submit">Acknowledge request</button>
                  </form>
                  <form method="post" action="/incidents/${incident.id}/start">
                    <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
                    <button class="button button-primary" type="submit">Mark work in progress</button>
                  </form>
                </div>
              </section>

              <section class="card action-card">
                <p class="eyebrow">Reply by email</p>
                <h2>Responder al inspector</h2>
                <p>Write in Spanish. The app translates the reply into English and sends it through the inspector mailbox.</p>
                <form method="post" action="/incidents/${incident.id}/reply">
                  <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
                  <label>
                    Mensaje en español
                    <textarea name="body" rows="6" maxlength="10000" required></textarea>
                  </label>
                  <button class="button button-primary" type="submit">Translate and send</button>
                </form>
              </section>

              <section class="card action-card">
                <p class="eyebrow">Close request</p>
                <h2>Document completion</h2>
                <form method="post" enctype="multipart/form-data" action="/incidents/${incident.id}/resolve">
                  <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
                  <label>
                    Completion notes in Spanish
                    <textarea name="notes" rows="5" maxlength="10000" required></textarea>
                  </label>
                  <label>
                    Completion photo
                    <input type="file" name="photo" accept="image/jpeg,image/png,image/webp">
                  </label>
                  <label class="checkbox-row">
                    <input type="checkbox" name="notifyInspector" value="yes" checked>
                    Email the English completion note to the inspector
                  </label>
                  <button class="button button-success" type="submit">Resolve and close</button>
                </form>
              </section>`
            : `<section class="card action-card resolved-card">
                <p class="eyebrow">Closed</p>
                <h2>Request resolved</h2>
                <p>${escapeHtml(incident.resolution_notes ?? "No completion notes were entered.")}</p>
                <p><strong>Resolved:</strong> ${escapeHtml(formatDate(incident.resolved_at))}</p>
                ${
                  incident.status === "RESOLVED"
                    ? `<form method="post" action="/incidents/${incident.id}/archive">
                         <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
                         <button class="button button-quiet" type="submit">Archive request</button>
                       </form>`
                    : ""
                }
              </section>`
        }

        <section class="card action-card">
          <p class="eyebrow">Audit trail</p>
          <h2>Activity</h2>
          <ul class="audit-list">${auditList(options.audits)}</ul>
        </section>
      </aside>
    </section>
  `;

  return layout(incident.subject, body, { csrf: options.csrf });
}

export function renderError(
  status: number,
  title: string,
  message: string,
  csrf?: string,
): string {
  return layout(
    title,
    `<section class="empty-state card">
      <p class="eyebrow">Error ${status}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="button button-primary" href="/dashboard">Return to dashboard</a>
    </section>`,
    { csrf },
  );
}
