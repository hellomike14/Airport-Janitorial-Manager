import express, { type RequestHandler } from "express";
import multer from "multer";
import { normalizeInboundParseFields } from "./inboundParsePolicy";
import { verifyInboundWebhookSecret } from "./sendgridEmailBridge";

// Preserve the message even when Outlook includes signatures or attachments.
// Files remain in Outlook: drain bounded streams without storing their contents.
const parse = multer({ storage: {
  _handleFile(_req, file, callback) {
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      callback(error, {});
    };
    file.stream.once("error", finish);
    file.stream.once("end", () => finish(null));
    file.stream.resume();
  },
  _removeFile(_req, _file, callback) { callback(null); },
}, limits: { fields: 32, fieldSize: 256 * 1024, files: 10, fileSize: 5 * 1024 * 1024, parts: 42 } }).any();

export const inboundParseMiddleware: RequestHandler = (req, res, next) => {
  const credential = req.header("x-sendgrid-inbound-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    (typeof req.query.secret === "string" ? req.query.secret : undefined);
  if (!verifyInboundWebhookSecret(credential)) {
    res.status(401).json({ error: "Invalid webhook credential" }); return;
  }
  if (req.is("multipart/form-data")) {
    parse(req, res, (error) => {
      if (error) { res.status(413).json({ error: "Inbound payload rejected" }); return; }
      try { req.body = normalizeInboundParseFields(req.body); }
      catch { res.status(400).json({ error: "Invalid inbound envelope" }); return; }
      next();
    });
    return;
  }
  express.json({ limit: "256kb", strict: true })(req, res, next);
};
