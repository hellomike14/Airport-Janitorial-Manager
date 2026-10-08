import { randomUUID } from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";

const transport = process.env.NODE_ENV === "production"
  ? undefined
  : pino.transport({
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
    });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL?.trim() || "info",
    name: "marvol-api",
    redact: {
      paths: ["req.headers.*", "req.body", "body", "recipientEmail", "to", "res.headers.*"],
      censor: "[REDACTED]",
    },
  },
  transport,
);

export const requestLogger = pinoHttp({
  logger,
  genReqId: () => randomUUID(),
  serializers: {
    req: (req) => ({ method: req.method }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
