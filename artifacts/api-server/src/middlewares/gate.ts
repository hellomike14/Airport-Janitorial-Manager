import type { Request, Response, NextFunction } from "express";
import { verifyGateToken, gateTokenFromRequest } from "../routes/gate";

// Paths (relative to the /api mount) reachable without unlocking the gate.
// Kept minimal: the public /apply job portal needs to submit applications
// and upload resumes; health checks must stay open for deployments.
function isPublic(req: Request): boolean {
  const path = req.path;
  if (path === "/health" || path === "/healthz" || path.startsWith("/gate")) return true;
  if (req.method === "POST" && path === "/applications") return true;
  if (req.method === "POST" && path === "/storage/uploads/request-url") return true;
  return false;
}

export function gateMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isPublic(req)) {
    next();
    return;
  }
  if (verifyGateToken(gateTokenFromRequest(req))) {
    next();
    return;
  }
  res.status(401).json({ error: "Locked", gate: true });
}
