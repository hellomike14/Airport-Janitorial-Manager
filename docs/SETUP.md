# Inspector Email Bridge: Setup and Deployment

This application keeps airport inspectors in email while supervisors manage bilingual, timed, documented requests inside the Airport Janitorial Manager.

It does not use Replit or Replit credits.

## Included workflow

1. An inspector emails a dedicated Microsoft 365 mailbox such as `inspectors@marvolenterprises.com`.
2. Microsoft Graph sends the message into the application. GitHub Actions also checks the mailbox every five minutes as a fallback.
3. The application creates an urgent request with the sender, subject, message, timestamp, attachments, location clues, assignment, and deadline.
4. The original English and Spanish translation appear together.
5. Weekday requests route to Priscilla. Weekend requests route to Ronaldo. Both names and email addresses are configurable.
6. The internal timer defaults to 15 minutes. Unresolved requests automatically become overdue and escalate.
7. Supervisors write replies in Spanish. The application translates and emails the inspector in English.
8. Supervisors resolve the request with completion notes and an optional photo.
9. Resolved and archived requests remain searchable with a full audit trail.

## Run locally

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000` and use the password stored in `ADMIN_PASSWORD`.

The PostgreSQL schema is created automatically when the application starts.

For a non-Docker development run:

```bash
npm install
npm run check
npm run dev
```

## Microsoft 365 configuration

Create a dedicated mailbox for inspector communication.

Register an application in Microsoft Entra and grant the Microsoft Graph application permissions needed to read the dedicated mailbox and send mail. Grant tenant admin consent, create a client secret, and restrict application access to the dedicated mailbox using the mailbox access controls available in the Microsoft 365 tenant.

Set:

```text
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_MAILBOX
GRAPH_WEBHOOK_CLIENT_STATE
```

After deploying the application on a public HTTPS domain, sign in and click **Refresh webhook**. This creates or renews the mailbox change-notification subscription.

## Translation configuration

Use either OpenAI or Azure AI Translator.

OpenAI:

```text
TRANSLATION_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TRANSLATION_MODEL=gpt-4.1-mini
```

Azure AI Translator:

```text
TRANSLATION_PROVIDER=azure
AZURE_TRANSLATOR_KEY=...
AZURE_TRANSLATOR_REGION=...
AZURE_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
```

With `TRANSLATION_PROVIDER=auto`, the application uses Azure when its credentials are present, then OpenAI, then displays the original message with a clear translation status if neither provider is configured.

## GitHub Actions configuration

Add these repository secrets after the application is deployed:

```text
APP_URL=https://your-deployed-domain.example
CRON_SECRET=the-same-long-secret-used-by-the-application
```

The workflow at `.github/workflows/operations.yml` then:

- checks for new inspector email;
- escalates requests that pass the internal deadline; and
- renews the Microsoft Graph webhook before it expires.

## Production requirements

The application runs as a standard Docker service. Production needs:

- a public HTTPS domain;
- a PostgreSQL database;
- the environment values in `.env.example`; and
- a host that runs the container continuously.

```bash
docker build -t airport-janitorial-manager .
docker run --env-file .env -p 3000:3000 airport-janitorial-manager
```

A VPS or any normal container platform can host it. Replit is not part of the deployment.

## Security already included

- signed, HTTP-only sessions;
- same-site cookies and form tokens;
- origin checks for authenticated actions;
- protected scheduled-job endpoints;
- Microsoft webhook `clientState` validation;
- security headers;
- attachment type and size restrictions;
- idempotent email intake; and
- database audit records.

Before launch, replace all development secrets, use HTTPS, use a managed secret store, and scope Microsoft application access to the inspector mailbox.

## Acceptance test

1. Send an English email with a location and photo to the inspector mailbox.
2. Confirm a new request appears with original English and Spanish translation.
3. Confirm the correct weekday or weekend supervisor receives an alert.
4. Acknowledge the request and mark it in progress.
5. Write a Spanish reply and confirm the inspector receives English email.
6. Resolve the request with Spanish completion notes and a photo.
7. Search for the closed request and confirm the audit trail records every action.
8. Leave a test request open past the internal deadline and confirm overdue escalation.
