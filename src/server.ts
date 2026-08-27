import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import helmet from "helmet";
import multer from "multer";
import {
  clearSession,
  createSession,
  getSession,
  passwordMatches,
  requireAuth,
  requireCron,
  requireCsrf,
} from "./auth.js";
import { closeDatabase, migrate } from "./db.js";
import { config } from "./config.js";
import {
  acknowledgeIncident,
  archiveIncident,
  escalateOverdue,
  getAttachment,
  getDashboardStats,
  getIncident,
  getSyncState,
  listIncidents,
  renewGraphSubscription,
  replyToInspector,
  resolveIncident,
  startIncident,
  syncMailbox,
} from "./operations.js";
import {
  renderDashboard,
  renderError,
  renderIncident,
  renderLogin,
} from "./views.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "250kb" }));
app.use(cookieParser());
app.use(express.static(path.resolve(__dirname, "../public"), { maxAge: "1h" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.attachmentMaxBytes,
    files: 1,
    fields: 20,
  },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    callback(
      allowed.has(file.mimetype)
        ? null
        : new Error("Completion photo must be JPEG, PNG, or WebP."),
      allowed.has(file.mimetype),
    );
  },
});

const asyncRoute =
  (
    handler: (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>,
  ): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

function adminActor(req: Request): string {
  return getSession(req)?.subject ?? "operations-admin";
}

function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function redirectWithMessage(
  res: Response,
  location: string,
  key: "message" | "error",
  value: string,
): void {
  const separator = location.includes("?") ? "&" : "?";
  res.redirect(303, `${location}${separator}${key}=${encodeURIComponent(value)}`);
}

app.get("/health", asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    service: "airport-janitorial-manager",
    time: new Date().toISOString(),
  });
}));

app.get("/", (req, res) => {
  res.redirect(303, getSession(req) ? "/dashboard" : "/login");
});

app.get("/login", (req, res) => {
  if (getSession(req)) {
    res.redirect(303, "/dashboard");
    return;
  }
  res.send(renderLogin(undefined, safeNext(req.query.next)));
});

app.post("/login", (req, res) => {
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const next = safeNext(req.body.next);

  if (!passwordMatches(password)) {
    res.status(401).send(renderLogin("That password is not valid.", next));
    return;
  }

  createSession(res);
  res.redirect(303, next);
});

app.post("/logout", requireAuth, requireCsrf, (req, res) => {
  clearSession(res);
  res.redirect(303, "/login");
});

app.get("/dashboard", requireAuth, asyncRoute(async (req, res) => {
  const session = getSession(req);
  if (!session) return;

  const status =
    typeof req.query.status === "string" ? req.query.status : "open";
  const query = typeof req.query.q === "string" ? req.query.q : "";

  const [incidents, stats, sync] = await Promise.all([
    listIncidents({ status, query }),
    getDashboardStats(),
    getSyncState(),
  ]);

  res.send(
    renderDashboard({
      csrf: session.csrf,
      incidents,
      stats,
      sync,
      status,
      query,
      message:
        typeof req.query.message === "string" ? req.query.message : undefined,
    }),
  );
}));

app.get("/incidents/:id", requireAuth, asyncRoute(async (req, res) => {
  const session = getSession(req);
  if (!session) return;

  const bundle = await getIncident(req.params.id);
  if (!bundle) {
    res.status(404).send(renderError(404, "Request not found", "The request does not exist.", session.csrf));
    return;
  }

  res.send(
    renderIncident({
      csrf: session.csrf,
      ...bundle,
      error: typeof req.query.error === "string" ? req.query.error : undefined,
      message:
        typeof req.query.message === "string" ? req.query.message : undefined,
    }),
  );
}));

app.get("/attachments/:id", requireAuth, asyncRoute(async (req, res) => {
  const attachment = await getAttachment(req.params.id);
  if (!attachment) {
    res.status(404).send("Attachment not found.");
    return;
  }
  if (!attachment.content) {
    res.status(410).send(
      "The attachment metadata was saved, but the file was too large to store in the application database.",
    );
    return;
  }

  const safeName = attachment.name.replace(/[\r\n\"]/g, "_");
  res.setHeader("content-type", attachment.mimeType);
  res.setHeader("content-disposition", `attachment; filename="${safeName}"`);
  res.send(attachment.content);
}));

app.post(
  "/incidents/:id/acknowledge",
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    await acknowledgeIncident(req.params.id, adminActor(req));
    redirectWithMessage(res, `/incidents/${req.params.id}`, "message", "Request acknowledged.");
  }),
);

app.post(
  "/incidents/:id/start",
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    await startIncident(req.params.id, adminActor(req));
    redirectWithMessage(res, `/incidents/${req.params.id}`, "message", "Work marked in progress.");
  }),
);

app.post(
  "/incidents/:id/reply",
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const body = typeof req.body.body === "string" ? req.body.body : "";
    try {
      await replyToInspector(req.params.id, body, adminActor(req));
      redirectWithMessage(res, `/incidents/${req.params.id}`, "message", "English reply sent to the inspector.");
    } catch (error) {
      redirectWithMessage(
        res,
        `/incidents/${req.params.id}`,
        "error",
        error instanceof Error ? error.message : "Reply could not be sent.",
      );
    }
  }),
);

app.post(
  "/incidents/:id/resolve",
  requireAuth,
  upload.single("photo"),
  requireCsrf,
  asyncRoute(async (req, res) => {
    const notes = typeof req.body.notes === "string" ? req.body.notes : "";
    const notifyInspector = req.body.notifyInspector === "yes";
    const photo = req.file
      ? {
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        }
      : undefined;

    try {
      await resolveIncident(req.params.id, {
        notesSpanish: notes,
        actor: adminActor(req),
        notifyInspector,
        ...(photo ? { completionPhoto: photo } : {}),
      });
      redirectWithMessage(res, `/incidents/${req.params.id}`, "message", "Request resolved and documented.");
    } catch (error) {
      redirectWithMessage(
        res,
        `/incidents/${req.params.id}`,
        "error",
        error instanceof Error ? error.message : "Request could not be resolved.",
      );
    }
  }),
);

app.post(
  "/incidents/:id/archive",
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    await archiveIncident(req.params.id, adminActor(req));
    redirectWithMessage(res, "/dashboard?status=ARCHIVED", "message", "Request archived.");
  }),
);

app.post(
  "/operations/sync",
  requireAuth,
  requireCsrf,
  asyncRoute(async (_req, res) => {
    try {
      const result = await syncMailbox();
      redirectWithMessage(
        res,
        "/dashboard",
        "message",
        `Mailbox synced: ${result.created} new request(s), ${result.updated} follow-up(s).`,
      );
    } catch (error) {
      redirectWithMessage(
        res,
        "/dashboard",
        "message",
        `Mailbox sync could not run: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }),
);

app.post(
  "/operations/subscription",
  requireAuth,
  requireCsrf,
  asyncRoute(async (_req, res) => {
    try {
      const result = await renewGraphSubscription();
      redirectWithMessage(
        res,
        "/dashboard",
        "message",
        result.changed
          ? `Microsoft webhook renewed through ${result.expiresAt ?? "the next renewal window"}.`
          : `Microsoft webhook is already current through ${result.expiresAt ?? "the next renewal window"}.`,
      );
    } catch (error) {
      redirectWithMessage(
        res,
        "/dashboard",
        "message",
        `Webhook renewal could not run: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }),
);

app.post(
  "/api/jobs/sync-mail",
  requireCron,
  asyncRoute(async (_req, res) => {
    res.json(await syncMailbox());
  }),
);

app.post(
  "/api/jobs/escalate",
  requireCron,
  asyncRoute(async (_req, res) => {
    res.json(await escalateOverdue());
  }),
);

app.post(
  "/api/jobs/renew-subscription",
  requireCron,
  asyncRoute(async (_req, res) => {
    res.json(await renewGraphSubscription());
  }),
);

app.post("/api/webhooks/microsoft", (req, res) => {
  const validationToken =
    typeof req.query.validationToken === "string"
      ? req.query.validationToken
      : null;

  if (validationToken) {
    res.type("text/plain").status(200).send(validationToken);
    return;
  }

  const notifications = Array.isArray(req.body?.value)
    ? (req.body.value as Array<{ clientState?: string }>)
    : [];

  const expected = config.microsoft.webhookClientState;
  const isValid =
    Boolean(expected) &&
    notifications.length > 0 &&
    notifications.every((item) => item.clientState === expected);

  if (!isValid) {
    res.status(401).json({ error: "Invalid webhook client state." });
    return;
  }

  res.status(202).json({ accepted: true });

  setImmediate(() => {
    void syncMailbox().catch((error) => {
      console.error("Webhook-triggered mailbox sync failed", error);
    });
  });
});

app.use((req, res) => {
  const session = getSession(req);
  res
    .status(404)
    .send(renderError(404, "Page not found", "The requested page does not exist.", session?.csrf));
});

app.use(
  (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    console.error("Unhandled request error", error);
    const session = getSession(req);
    const message =
      config.nodeEnv === "production"
        ? "The request could not be completed."
        : error instanceof Error
          ? error.message
          : "Unknown error";

    res
      .status(500)
      .send(renderError(500, "Request failed", message, session?.csrf));
  },
);

async function start(): Promise<void> {
  await migrate();
  const server = app.listen(config.port, () => {
    console.log(
      `Airport Janitorial Manager listening at ${config.appUrl} on port ${config.port}`,
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; closing server.`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void start().catch((error) => {
  console.error("Application failed to start", error);
  process.exit(1);
});
