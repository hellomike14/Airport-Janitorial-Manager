const DEFAULT_NOTIFICATION_RECIPIENTS = ["msutherland@marvolenterprises.com"];

type Environment = Record<string, string | undefined>;

export interface InspectorRequestEmail {
  requesterName: string;
  areaName: string;
  requestedDate: string;
  details: string;
  appUrl?: string;
}

export type InspectorRequestEmailResult =
  | { status: "sent"; recipientCount: number }
  | { status: "disabled" | "not_configured" | "failed"; recipientCount: number; error?: string };

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

export function notificationRecipients(env: Environment = process.env): string[] {
  const raw =
    env.INSPECTOR_REQUEST_NOTIFY_EMAILS === undefined
      ? DEFAULT_NOTIFICATION_RECIPIENTS.join(",")
      : env.INSPECTOR_REQUEST_NOTIFY_EMAILS;

  return [...new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function singleLine(value: string, maxLength: number): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

export function buildInspectorRequestEmail(input: InspectorRequestEmail): {
  subject: string;
  body: string;
} {
  const areaName = singleLine(input.areaName, 120) || "Unspecified area";
  const requesterName = singleLine(input.requesterName, 120) || "Inspector";
  const appUrl = input.appUrl?.replace(/\/$/, "");
  const body = [
    "A new inspector request was submitted in Airport Janitorial Manager.",
    "",
    `Requested by: ${requesterName}`,
    `Area: ${areaName}`,
    `Work date: ${singleLine(input.requestedDate, 40)}`,
    "",
    "Request:",
    input.details.trim(),
    ...(appUrl ? ["", `Open requests: ${appUrl}/special-requests`] : []),
  ].join("\n");

  return {
    subject: `[Inspector Request] ${areaName}`,
    body,
  };
}

function graphConfiguration(env: Environment) {
  return {
    tenantId: env.MICROSOFT_TENANT_ID?.trim(),
    clientId: env.MICROSOFT_CLIENT_ID?.trim(),
    clientSecret: env.MICROSOFT_CLIENT_SECRET?.trim(),
    mailbox: env.MICROSOFT_MAILBOX?.trim().toLowerCase(),
  };
}

async function graphAccessToken(env: Environment): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const config = graphConfiguration(env);
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId!)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Microsoft Graph token request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("Microsoft Graph token response did not include an access token");
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return payload.access_token;
}

export async function sendInspectorRequestEmail(
  input: InspectorRequestEmail,
  env: Environment = process.env,
): Promise<InspectorRequestEmailResult> {
  const recipients = notificationRecipients(env);
  if (recipients.length === 0) {
    return { status: "disabled", recipientCount: 0 };
  }

  const config = graphConfiguration(env);
  if (!config.tenantId || !config.clientId || !config.clientSecret || !config.mailbox) {
    return { status: "not_configured", recipientCount: recipients.length };
  }

  try {
    const token = await graphAccessToken(env);
    const message = buildInspectorRequestEmail({
      ...input,
      appUrl: input.appUrl ?? env.PUBLIC_APP_URL,
    });
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/sendMail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "Text", content: message.body },
            toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Microsoft Graph sendMail failed with HTTP ${response.status}`);
    }

    return { status: "sent", recipientCount: recipients.length };
  } catch (error) {
    return {
      status: "failed",
      recipientCount: recipients.length,
      error: error instanceof Error ? error.message : "Unknown email delivery error",
    };
  }
}
