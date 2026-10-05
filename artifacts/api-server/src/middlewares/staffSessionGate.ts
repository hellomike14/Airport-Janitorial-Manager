import type { Request, Response, NextFunction } from "express";

export function createStaffSessionGate(hasSession: (req: Request) => boolean, resolveActor: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const publicRequest = req.path === "/health" || req.path === "/healthz" ||
      (req.method === "POST" && ["/applications", "/storage/uploads/request-url"].includes(req.path)) ||
      (req.method === "GET" && req.path.startsWith("/storage/public-objects/"));
    if (publicRequest) { next(); return; }
    // The identity route owns all four structured failure responses, including
    // an absent/expired verified session and its durable diagnostic id.
    if (req.method === "GET" && req.path === "/staff/me") { next(); return; }
    if (req.method === "POST" && req.path === "/auth-diagnostics/events") { next(); return; }
    if (!(await resolveActor(req))) { res.status(401).json({ error: "Login session required" }); return; }
    next();
  };
}
