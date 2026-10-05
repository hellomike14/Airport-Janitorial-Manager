export function normalizeInboundParseFields(body: Record<string, unknown>) {
  if (typeof body.email === "string") throw new Error("raw_mime_unsupported");
  const envelope = typeof body.envelope === "string" ? JSON.parse(body.envelope) : body.envelope;
  if (!envelope || typeof envelope !== "object") throw new Error("invalid_envelope");
  return { envelope, from: body.from, text: body.text, headers: body.headers, SPF: body.SPF ?? body.spf, dkim: body.dkim ?? body.DKIM };
}