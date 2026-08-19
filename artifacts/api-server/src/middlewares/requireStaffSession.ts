import type { NextFunction, Request, Response } from "express";
import { actorStaffFromRequest } from "../lib/actorSession";

function isPublicApiRequest(req: Request): boolean {
  if (req.path === "/health" || req.path === "/healthz") return true;
  if (req.method === "POST" && req.path === "/applications") return true;
  if (req.method === "POST" && req.path === "/storage/uploads/request-url") return true;
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

  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: "Login session required" });
    return;
  }

  next();
}