import { config } from "./config.js";

export interface GraphEmailAddress {
  emailAddress?: {
    name?: string;
    address?: string;
  };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: {
    contentType?: "text" | "html";
    content?: string;
  };
  hasAttachments?: boolean;
  "@removed"?: { reason?: string };
}

export interface GraphFileAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  "@odata.type"?: string;
}

interface GraphCollection<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface GraphSubscription {
  id: string;
  resource: string;
  clientState?: string;
  expirationDateTime: string;
}

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export function graphConfigured(): boolean {
  return Boolean(
    config.microsoft.tenantId &&
      config.microsoft.clientId &&
      config.microsoft.clientSecret &&
      config.microsoft.mailbox,
  );
}

function assertGraphConfigured(): void {
  if (!graphConfigured()) {
    throw new Error(
      "Microsoft Graph is not configured. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_MAILBOX.",
    );
  }
}

async function getAccessToken(): Promise<string> {
  assertGraphConfigured();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const tenantId = config.microsoft.tenantId as string;
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.microsoft.clientId as string,
        client_secret: config.microsoft.clientSecret as string,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!response.ok) {
    throw new GraphError(
      "Unable to obtain a Microsoft Graph access token.",
      response.status,
      await response.text(),
    );
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedToken.value;
}

function graphUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("https://graph.microsoft.com/")) return pathOrUrl;
  if (!pathOrUrl.startsWith("/")) return `https://graph.microsoft.com/v1.0/${pathOrUrl}`;
  return `https://graph.microsoft.com/v1.0${pathOrUrl}`;
}

async function graphRequest<T>(
  pathOrUrl: string,
  init: RequestInit = {},
  preferPlainText = false,
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (preferPlainText) {
    headers.set("Prefer", 'outlook.body-content-type="text"');
  }

  const response = await fetch(graphUrl(pathOrUrl), {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GraphError(
      `Microsoft Graph request failed with HTTP ${response.status}.`,
      response.status,
      body,
    );
  }

  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function mailboxPath(): string {
  assertGraphConfigured();
  return `/users/${encodeURIComponent(config.microsoft.mailbox as string)}`;
}

export async function getMessageDelta(deltaLink?: string | null): Promise<{
  messages: GraphMessage[];
  deltaLink: string;
}> {
  let nextUrl =
    deltaLink ||
    `${mailboxPath()}/mailFolders/inbox/messages/delta?` +
      new URLSearchParams({
        "$select":
          "id,conversationId,internetMessageId,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments",
        "$top": "50",
      }).toString();

  const messages: GraphMessage[] = [];
  let finalDeltaLink = deltaLink ?? "";

  for (let page = 0; page < 30 && nextUrl; page += 1) {
    const payload = await graphRequest<GraphCollection<GraphMessage>>(
      nextUrl,
      {},
      true,
    );

    messages.push(...(payload.value ?? []));
    const next = payload["@odata.nextLink"];
    const delta = payload["@odata.deltaLink"];

    if (delta) finalDeltaLink = delta;
    nextUrl = next ?? "";
  }

  if (!finalDeltaLink) {
    throw new Error("Microsoft Graph delta query did not return a delta link.");
  }

  return { messages, deltaLink: finalDeltaLink };
}

export async function getMessageAttachments(
  providerMessageId: string,
): Promise<GraphFileAttachment[]> {
  const payload = await graphRequest<GraphCollection<GraphFileAttachment>>(
    `${mailboxPath()}/messages/${encodeURIComponent(providerMessageId)}/attachments`,
  );
  return payload.value ?? [];
}

export async function sendMail(
  recipients: string[],
  subject: string,
  bodyText: string,
): Promise<void> {
  const cleanRecipients = [...new Set(recipients.map((item) => item.trim()).filter(Boolean))];
  if (!cleanRecipients.length) return;

  await graphRequest<void>(`${mailboxPath()}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: "Text",
          content: bodyText,
        },
        toRecipients: cleanRecipients.map((address) => ({
          emailAddress: { address },
        })),
      },
      saveToSentItems: true,
    }),
  });
}

export async function replyToMessage(
  providerMessageId: string,
  bodyText: string,
): Promise<void> {
  await graphRequest<void>(
    `${mailboxPath()}/messages/${encodeURIComponent(providerMessageId)}/reply`,
    {
      method: "POST",
      body: JSON.stringify({ comment: bodyText }),
    },
  );
}

export async function createOrRenewSubscription(existingId?: string): Promise<GraphSubscription> {
  assertGraphConfigured();

  if (!config.microsoft.webhookClientState) {
    throw new Error("GRAPH_WEBHOOK_CLIENT_STATE is required for webhook subscriptions.");
  }

  const expirationDateTime = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();

  if (existingId) {
    return graphRequest<GraphSubscription>(`/subscriptions/${encodeURIComponent(existingId)}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime }),
    });
  }

  return graphRequest<GraphSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created,updated",
      notificationUrl: `${config.appUrl}/api/webhooks/microsoft`,
      resource: `${mailboxPath()}/mailFolders('inbox')/messages`,
      expirationDateTime,
      clientState: config.microsoft.webhookClientState,
      latestSupportedTlsVersion: "v1_2",
    }),
  });
}
