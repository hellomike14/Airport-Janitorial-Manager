# Airport Janitorial Manager

This repository is the source-controlled home for the Airport Janitorial Manager application.

## Production identity setup

The application authorizes a verified Clerk session by matching its **verified primary email** to an active, login-enabled staff record. Email matching is trimmed and case-insensitive.

Approved production identities currently reconciled at API startup:

| Staff member | Production login email |
| --- | --- |
| Michael | `michael@massifkroo.com` |
| MCO Inspector | `inspector@marvolenterprises.com` |
| Priscila Rosero | `priscilarosero27@gmail.com` |
| Reynaldo Hernandez Suarez | `cnuevo986@gmail.com` |
| Ivan Serrano | `ivanserrano737@gmail.com` |
| Kevin Gonzalez Fernandez | `kevingonzalez2015830@gmail.com` |
| Steeve Alphonse | `steevealphonse86@gmail.com` |
| John Nelson Louis | `louiszya3@gmail.com` |
| Diego Moreno Velez | `diegomoreno198419@gmail.com` |
| Luis Garcia | `kikeyuli1112@gmail.com` |
| Alexis Moron | `alexismoron733@gmail.com` |
| JeanFranco Perez | `jeanfranco985@gmail.com` |

Edner Jules, Jason Delgado, Jean Gardy Rigueur, Jose Camargo, and Juan Carlos
Zurita Blacio cannot be granted email-based access until their email addresses
are added to the roster.

`msutherland@marvolenterprises.com` is **notification-only**. The API explicitly denies that address, deactivates/disables any legacy Marcell staff row at startup, and prevents an administrator from assigning the address to a login-enabled staff record.

Clerk development and production are separate environments. A user that exists in development does not automatically exist in production. Before launch, create/invite each approved address in the production Auth environment (or have the employee use the production **Sign up** link), then verify that the same address is the account's verified primary email.

The production client and API must use keys from the same Clerk environment:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

## Inspector-request email

Only requests submitted by the inspector trigger the external notification path. By default, the recipient list contains only `msutherland@marvolenterprises.com`. Configure these deployment secrets/variables to enable Microsoft Graph delivery:

```dotenv
INSPECTOR_REQUEST_NOTIFY_EMAILS=msutherland@marvolenterprises.com
PUBLIC_APP_URL=https://airport-janitorial-manager.replit.app
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_MAILBOX=
```

The Microsoft Entra application needs application permission to send mail from the configured mailbox. Never commit the tenant secret or client secret. With incomplete Graph configuration, the request is still saved in the app and the API reports/logs `not_configured` instead of pretending the email was delivered.

## Two-way SendGrid conversation email

This is separate from the Microsoft Graph inspector-request notification above. When an authenticated supervisor sends an in-app 1:1 message to the active inspector, the message and durable email intent are committed together. The request then waits for one bounded SendGrid attempt; transient failures remain in the database outbox for retry. The response header and message UI report the persisted status rather than claiming mailbox delivery.

Configure these deployment secrets/variables (never commit their values):

```dotenv
SENDGRID_EMAIL_BRIDGE_ENABLED=true
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=messages@marvolenterprises.com
SENDGRID_INBOUND_DOMAIN=replies.marvolenterprises.com
SENDGRID_REPLY_TOKEN_SECRET=
SENDGRID_INBOUND_WEBHOOK_SECRET=
SENDGRID_REPLY_TOKEN_TTL_DAYS=30
MESSAGE_EMAIL_OUTBOX_POLL_MS=1000
MESSAGE_EMAIL_OUTBOX_LEASE_MS=60000
MESSAGE_EMAIL_OUTBOX_BATCH_SIZE=10
MESSAGE_EMAIL_OUTBOX_MAX_ATTEMPTS=8
INTERNAL_CRON_SECRET=
INSPECTOR_ESCALATION_POLL_MS=30000
PUBLIC_APP_URL=https://airport-janitorial-manager.replit.app
```

- Give `SENDGRID_API_KEY` only the Mail Send permission. Authenticate the domain or verify `SENDGRID_FROM_EMAIL` in SendGrid before enabling the bridge.
- Generate `SENDGRID_REPLY_TOKEN_SECRET` and `SENDGRID_INBOUND_WEBHOOK_SECRET` independently, with at least 32 random characters each. Rotating the reply-token secret immediately invalidates outstanding email Reply-To links.
- Supervisor-to-inspector messages and their email intents are committed together with a client-generated idempotency key. The API holds the originating request for one bounded Mail Send attempt, then the lease-based database outbox retries transient failures with exponential backoff. The message UI reports `pending`, `retrying`, `accepted`, unavailable, or failed truthfully; `accepted` means SendGrid accepted the API request, not that the recipient mailbox confirmed delivery.
- Use a dedicated inbound hostname such as `replies.marvolenterprises.com`. Add an MX record **only for that subdomain**, priority `10`, pointing to `mx.sendgrid.net.`. Do not change the existing `marvolenterprises.com` MX records used by Microsoft 365.
- In SendGrid Inbound Parse, set the receiving hostname to that exact subdomain and the destination to `https://airport-janitorial-manager.replit.app/api/webhooks/sendgrid/inbound?secret=<URL-encoded SENDGRID_INBOUND_WEBHOOK_SECRET>`. Leave **POST the raw, full MIME message** off; this endpoint expects SendGrid's default multipart fields. The webhook URL must be direct HTTPS because SendGrid Inbound Parse does not follow redirects. If the delivery service can set headers, `X-SendGrid-Inbound-Secret` or `Authorization: Bearer ...` is preferred over the query parameter.
- SendGrid must include a passing SPF or DKIM result. The API also requires the envelope sender and visible From address to exactly match the inspector email embedded in the signed conversation token.

Inbound Parse posts are bounded multipart payloads. Only sanitized plain text (maximum 2,000 characters) is inserted; attachments and HTML are ignored. A provider Message-ID hash prevents retry duplicates. Accepted replies are inserted as the inspector, unarchive the conversation for its participants, and create an unread `inspector_to_supervisor` urgent notification. Group conversations and inactive, login-disabled, missing-email, or notification-only contacts are rejected.

### Inspector email → urgent special assignment

The inspector should reply to an app-generated email and include a configured area on its own line. A fully qualified terminal + area avoids ambiguous names:

```text
Location: Terminal B - East / Level 4 - Row C-G
Date: 2026-09-02
Coordinates: 28.4312, -81.3081

Please remove the spill near the elevator entrance.
```

`Date` and `Coordinates` are optional. The API auto-creates the task only when `Location` has one exact, unambiguous match. Otherwise the email remains an urgent item in **Special Requests → Inspector Messages**, where the supervisor confirms the area. Candidates are limited to active, login-enabled staff assigned to that area/date. With valid target coordinates and fresh staff GPS, the nearest candidate is selected; otherwise the least-loaded on-area candidate is selected deterministically. Managers and the selected employee receive urgent in-app notifications.

Inspector-origin assignments have a persisted 15-minute deadline. At the deadline, an incomplete task is marked escalated, every active supervisor/admin is notified, and the next eligible on-area employee is assigned when available. Completion creates one idempotent outbox email back to `inspector@marvolenterprises.com`; duplicate completion taps cannot email twice.

The process also sweeps every 30 seconds while an instance is awake. For a dependable SLA on an autoscale deployment, configure an external one-minute scheduler to POST:

```text
https://airport-janitorial-manager.replit.app/api/tasks/internal/inspector-escalations/sweep
Authorization: Bearer <INTERNAL_CRON_SECRET>
```

Use an independent random `INTERNAL_CRON_SECRET` of at least 32 characters. Without that scheduler (or an always-on deployment), a sleeping autoscale instance can process the escalation only when it next receives traffic.

After deployment, verify one supervisor-to-inspector message, reply from that inspector's exact mailbox, and confirm one in-app reply/urgent notification even if the same webhook payload is retried. Monitor `inspector_message_email` and `sendgrid_inbound_reply` structured log events during rollout.

## Build and publish checklist

This workspace requires Node.js 24 and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server test
pnpm run typecheck
pnpm run build
```

Publishing is a separate production snapshot in Replit. After merging the intended commit, republish the application and confirm `GET /api/healthz` returns HTTP 200. On the four phones, fully close the old browser/PWA tab and reopen the production URL so the updated service worker and sign-in recovery UI take control.

API startup applies the idempotent staff-login, conversation/archive/outbox, inspector-task SLA, and inbound-email idempotency schema reconciliation before opening the HTTP listener. The deployment database role therefore needs permission to create/alter tables and indexes and to update staff records.
