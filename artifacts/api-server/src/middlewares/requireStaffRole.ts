import type { NextFunction, Request, Response } from "express";
import { actorStaffFromRequest } from "../lib/actorSession";

type StaffRole = "admin" | "supervisor" | "inspector" | "staff" | "employee_administrator";

/** Requires a verified Clerk session linked to a staff member in an allowed role. */
export function createStaffRoleGate(
  resolveActor: (req: Request) => Promise<{ role: string } | null> = actorStaffFromRequest,
) {
  return (...allowedRoles: StaffRole[]) => async (req: Request, res: Response, next: NextFunction) => {
    const actor = await resolveActor(req);
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

export const requireStaffRole = createStaffRoleGate();