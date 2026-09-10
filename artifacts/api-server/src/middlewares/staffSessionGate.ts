import type { Request, Response, NextFunction } from "express";

export function createStaffSessionGate(hasSession: (req: Request) => boolean, resolveActor: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const publicRequest = req.path === "/health" || req.path === "/healthz" ||
      (req.method === "POST" && ["/applications", "/storage/uploads/request-url"].includes(req.path)) ||
      (req.method === "GET" && req.path.startsWith("/storage/public-objects/"));
    if (publicRequest) { next(); return; }
    if (req.method === "GET" && req.path === "/staff/me") {
      if (!hasSession(req)) { res.status(401).json({ error: "SESSION_REQUIRED" }); return; }
      // The identity endpoint must return NO_STAFF_MATCH itself, rather than
      // being blocked here with a misleading session error.
      next(); return;
    }
    if (!(await resolveActor(req))) { res.status(401).json({ error: "Login session required" }); return; }
    next();
  };
}
