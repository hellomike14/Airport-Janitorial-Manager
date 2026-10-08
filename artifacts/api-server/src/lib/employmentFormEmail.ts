export const EMPLOYMENT_FORMS_RECIPIENT = "admin@marvolenterprises.com";
export const MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type EmploymentEmailAttachment = {
  filename: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
};

export type EmploymentEmail = {
  /** Optional one-off recipient; existing form mail continues to use the Admin default. */
  to?: string;
  subject: string;
  text: string;
  attachments: EmploymentEmailAttachment[];
};

export type EmploymentEmailSender = (message: EmploymentEmail) => Promise<void>;

export function sanitizeEmailFilename(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1)?.normalize("NFKC") ?? "";
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "employment-document";
}

export function formatCompletedFields(groups: Record<string, unknown>): string {
  const lines: string[] = [];
  const visit = (value: unknown, prefix: string) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`${prefix}: ${value.map(item => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")}`);
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) return;
      for (const [key, child] of entries) visit(child, prefix ? `${prefix} / ${key}` : key);
      return;
    }
    lines.push(`${prefix}: ${String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")}`);
  };
  visit(groups, "");
  return lines.join("\n") || "(No additional fields)";
}

export async function sendEmploymentFormEmailWithConfig(
  message: EmploymentEmail,
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
): Promise<void> {
  const apiKey = env.SENDGRID_API_KEY?.trim();
  const from = env.SENDGRID_FROM_EMAIL?.trim().toLowerCase();
  if (!apiKey || !from || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    throw new Error("EMPLOYMENT_EMAIL_NOT_CONFIGURED");
  }
  const recipient = message.to?.trim().toLowerCase() || EMPLOYMENT_FORMS_RECIPIENT;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    throw new Error("EMPLOYMENT_EMAIL_INVALID_RECIPIENT");
  }

  const totalBytes = message.attachments.reduce((sum, attachment) => sum + attachment.bytes.byteLength, 0);
  if (totalBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
    throw new Error("EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE");
  }

  const response = await send("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: recipient }] }],
      from: { email: from },
      subject: message.subject,
      content: [{ type: "text/plain", value: message.text }],
      attachments: message.attachments.map(attachment => ({
        content: attachment.bytes.toString("base64"),
        filename: sanitizeEmailFilename(attachment.filename),
        type: attachment.contentType,
        disposition: "attachment",
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`EMPLOYMENT_EMAIL_REJECTED_${response.status}`);
}

export const sendEmploymentFormEmail: EmploymentEmailSender = message =>
  sendEmploymentFormEmailWithConfig(message);
