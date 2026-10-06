import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { inboundParseMiddleware } from "./inboundParseMiddleware";
import { isAuthorizedInspectorEmailSender } from "./sendgridEmailBridge";

test("real multipart parsing accepts Outlook fields, long text and an attachment behind the webhook credential", async () => {
  const before = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET;
  const secret = "test-webhook-secret-".repeat(3);
  process.env.SENDGRID_INBOUND_WEBHOOK_SECRET = secret;
  const app = express();
  app.post("/inbound", inboundParseMiddleware, (req, res) => res.json(req.body));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inbound`;
  const payload = () => {
    const form = new FormData();
    const fields = {
      envelope: JSON.stringify({ from: "SRS0=fixture@marvolenterprises.com", to: ["inspector@replies.marvolenterprises.com"] }),
      from: '"Maynard, Ashley" <Ashley.Maynard@GOAA.org>', to: "inspector@marvolenterprises.com",
      subject: "Inspector initiated request", text: "Inspection details. ".repeat(300), html: "<p>Details</p>",
      headers: "Message-ID: <fixture@example.test>", SPF: "pass", dkim: "{@goaa.org : pass}",
      charsets: "{}", attachments: "1", "attachment-info": "{}", sender_ip: "192.0.2.1", spam_score: "0", spam_report: "",
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("attachment1", new Blob(["test photo bytes"]), "photo.txt");
    return form;
  };
  try {
    const denied = await fetch(url, { method: "POST", body: payload() });
    assert.equal(denied.status, 401);
    const response = await fetch(url, { method: "POST", headers: { "x-sendgrid-inbound-secret": secret }, body: payload() });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.subject, "Inspector initiated request");
    assert.ok(body.text.length > 2000);
    assert.match(body.text, /1 email attachment\(s\) remain in Outlook/);
    assert.equal(isAuthorizedInspectorEmailSender(body.from, body.envelope.from, body.SPF, body.dkim), "ashley.maynard@goaa.org");
    const invalid = new FormData(); invalid.append("envelope", "{");
    assert.equal((await fetch(url, { method: "POST", headers: { "x-sendgrid-inbound-secret": secret }, body: invalid })).status, 400);
    const oversized = payload(); oversized.set("attachment1", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), "large.bin");
    assert.equal((await fetch(url, { method: "POST", headers: { "x-sendgrid-inbound-secret": secret }, body: oversized })).status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (before === undefined) delete process.env.SENDGRID_INBOUND_WEBHOOK_SECRET;
    else process.env.SENDGRID_INBOUND_WEBHOOK_SECRET = before;
  }
});
