import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "./config.js";

const COOKIE_NAME = "ajm_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AppSession {
  subject: "operations-admin";
  csrf: string;
  exp: number;
}

function signature(value: string): string {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(value)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function secretMatches(left: string, right: string): boolean {
  return safeEqual(left, right);
}

function encodeSession(session: AppSession): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function decodeSession(raw: string | undefined): AppSession | null {
  if (!raw) return null;
  const [payload, providedSignature] = raw.split(".");
  if (!payload || !providedSignature || !safeEqual(signature(payload), providedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<AppSession>;

    if (
      parsed.subject !== "operations-admin" ||
      typeof parsed.csrf !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return parsed as AppSession;
  } catch {
    return null;
  }
}

export function passwordMatches(candidate: string): boolean {
  return safeEqual(candidate, config.adminPassword);
}

export function createSession(res: Response): AppSession {
  const session: AppSession = {
    subject: "operations-admin",
    csrf: crypto.randomBytes(24).toString("base64url"),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  res.cookie(COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });

  return session;
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production",
    path: "/",
  });
}

export function getSession(req: Request): AppSession | null {
  return decodeSession(req.cookies?.[COOKIE_NAME] as string | undefined);
}

export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = getSession(req);
  if (!session) {
    const destination = encodeURIComponent(req.originalUrl || "/dashboard");
    res.redirect(303, `/login?next=${destination}`);
    return;
  }

  res.locals.session = session;
  next();
};

function requestHasSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const configuredUrl = new URL(config.appUrl);
    return originUrl.host === configuredUrl.host || originUrl.host === req.get("host");
  } catch {
    return false;
  }
}

export const requireCsrf: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = getSession(req);
  const csrf = typeof req.body?.csrf === "string" ? req.body.csrf : "";

  if (!session || !requestHasSameOrigin(req) || !safeEqual(session.csrf, csrf)) {
    res.status(403).send("Invalid or expired form token.");
    return;
  }

  res.locals.session = session;
  next();
};

export const requireCron: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const headerSecret = req.get("x-cron-secret") ?? "";
  const candidate = bearer || headerSecret;

  if (!candidate || !safeEqual(candidate, config.cronSecret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};
