import type { NextFunction, Request, Response } from "express";
import { resolveActorStaffFromRequest, type StaffRow } from "../lib/actorSession";

type StaffRole = "admin" | "supervisor" | "inspector" | "staff";

/** Requires a verified Clerk session linked to a staff member in an allowed role. */
export function requireStaffRole(...allowedRoles: StaffRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let actor = res.locals.staffActor as StaffRow | undefined;
    if (!actor) {
      const resolution = await resolveActorStaffFromRequest(req);
      if (resolution.status === "unauthenticated") {
        res.status(401).json({ error: "Login session required" });
        return;
      }
      if (resolution.status === "clerk_unavailable") {
        res.status(503).json({ error: "Authentication service unavailable" });
        return;
      }
      if (resolution.status !== "ok") {
        res.status(403).json({ error: "Staff account is not authorized" });
        return;
      }
      actor = resolution.staff;
      res.locals.staffActor = actor;
    }
    if (!allowedRoles.includes(actor.role as StaffRole)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    next();
  };
}
