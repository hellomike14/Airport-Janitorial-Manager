export function normalizeInboundParseFields(body: Record<string, unknown>) {
  if (typeof body.email === "string") throw new Error("raw_mime_unsupported");
  const envelope = typeof body.envelope === "string" ? JSON.parse(body.envelope) : body.envelope;
  if (!envelope || typeof envelope !== "object") throw new Error("invalid_envelope");
  const attachments = Number(body.attachments ?? 0);
  if (!Number.isInteger(attachments) || attachments < 0 || attachments > 10) throw new Error("invalid_attachment_count");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const fallback = typeof body.html === "string" && body.html.trim()
    ? "[HTML-only email received. Open the original message in Outlook to read its content.]"
    : attachments > 0 ? "Email with attachments" : "";
  const note = attachments > 0 ? `\n\n[${attachments} email attachment(s) remain in Outlook; attachments are not imported into this conversation.]` : "";
  return { envelope, from: body.from, text: (text || fallback) + note, subject: body.subject, headers: body.headers, SPF: body.SPF ?? body.spf, dkim: body.dkim ?? body.DKIM };
}
