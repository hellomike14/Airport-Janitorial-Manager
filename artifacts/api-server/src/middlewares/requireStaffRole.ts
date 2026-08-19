import type { NextFunction, Request, Response } from "express";
import { actorStaffFromRequest } from "../lib/actorSession";

type StaffRole = "admin" | "supervisor" | "inspector" | "staff";

/** Requires a verified Clerk session linked to a staff member in an allowed role. */
export function requireStaffRole(...allowedRoles: StaffRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const actor = await actorStaffFromRequest(req);
    if (!actor) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    if (!allowedRoles.includes(actor.role as StaffRole)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    next();
  };
}