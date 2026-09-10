import express, { type Express, type ErrorRequestHandler } from "express";
import { AuthServiceUnavailable } from "./lib/authAvailability";
import multer from "multer";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { inboundSendgridRouter } from "./routes/messages";
import internalRouter from "./routes/internal";
import { normalizeInboundParseFields } from "./lib/inboundParsePolicy";

const app: Express = express();
const inboundParse = multer({ storage: multer.memoryStorage(), limits: { fields: 12, fieldSize: 64 * 1024, files: 0, fileSize: 1 } }).none();

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
// SendGrid cannot hold a Clerk session. This narrow route is parsed with a
// bounded JSON body and authenticates exclusively through its signed webhook
// credentials in the handler.
app.use("/api/webhooks/sendgrid/inbound", (req, res, next) => {
  if (req.is("multipart/form-data")) return inboundParse(req, res, (error) => {
    if (error) return res.status(413).json({ error: "Inbound payload rejected" });
    try {
      req.body = normalizeInboundParseFields(req.body);
      return next();
    } catch { return res.status(400).json({ error: "Invalid inbound envelope" }); }
  });
  return express.json({ limit: "64kb", strict: true })(req, res, next);
}, inboundSendgridRouter);
app.use("/api/internal", internalRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

const authUnavailableHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (!(error instanceof AuthServiceUnavailable)) { next(error); return; }
  if (res.headersSent) { next(error); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", "5");
  res.status(503).json({ error: "AUTH_TEMPORARILY_UNAVAILABLE" });
};
app.use(authUnavailableHandler);

export default app;
