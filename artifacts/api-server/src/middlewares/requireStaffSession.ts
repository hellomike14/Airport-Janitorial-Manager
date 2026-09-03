import type { NextFunction, Request, Response } from "express";
import { resolveActorStaffFromRequest } from "../lib/actorSession";

export function isPublicApiRequest(req: Pick<Request, "method" | "path">): boolean {
  if (req.path === "/health" || req.path === "/healthz") return true;
  // This session bridge must be reachable by a verified Clerk user who has no
  // staff match yet; the route itself distinguishes 401 from NO_STAFF_MATCH.
  if (req.method === "GET" && req.path === "/staff/me") return true;
  if (req.method === "POST" && req.path === "/applications") return true;
  if (req.method === "POST" && req.path === "/storage/uploads/request-url") return true;
  // The opaque, short-lived HMAC capability authenticates this byte upload;
  // public applicants do not have a Clerk session.
  if (
    req.method === "PUT" &&
    /^\/storage\/uploads\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(req.path)
  ) {
    return true;
  }
  // SendGrid cannot present a Clerk browser session. This exact endpoint has
  // its own independent shared-secret, signed-token, sender, and replay checks.
  if (req.method === "POST" && req.path === "/webhooks/sendgrid/inbound") return true;
  // A scheduler wakes autoscale deployments so the persisted 15-minute
  // inspector-task SLA is enforced even when no browser is open. The route
  // itself requires a separate 32+ character bearer secret.
  if (
    req.method === "POST" &&
    req.path === "/tasks/internal/inspector-escalations/sweep"
  ) {
    return true;
  }
  return req.method === "GET" && req.path.startsWith("/storage/public-objects/");
}

/**
 * Requires a verified Clerk session linked to an active staff record for all
 * private APIs. Public job applications and explicitly public file paths stay
 * available without a staff account.
 */
export async function requireStaffSession(req: Request, res: Response, next: NextFunction) {
  if (isPublicApiRequest(req)) {
    next();
    return;
  }

  const actor = await resolveActorStaffFromRequest(req);
  if (actor.status === "unauthenticated") {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (actor.status === "clerk_unavailable") {
    res.status(503).json({ error: "Authentication service unavailable" });
    return;
  }
  if (actor.status !== "ok") {
    res.status(403).json({ error: "Staff account is not authorized" });
    return;
  }

  res.locals.staffActor = actor.staff;
  next();
}
