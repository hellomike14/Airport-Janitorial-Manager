import type { Request, Response, NextFunction } from "express";
import { isPublicBlankEmploymentEmail, isPublicBlankEmploymentTemplate } from "../routes/employmentForms";
import { isPromotedCandidateRequest } from "../lib/onboardingCandidatePolicy";

export function createStaffSessionGate(
  hasSession: (req: Request) => boolean,
  resolveActor: (req: Request) => Promise<unknown>,
  resolveCandidate: (req: Request) => Promise<unknown> = async () => null,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.toLowerCase();
    if (["GET", "HEAD"].includes(req.method) &&
        (/^\/(?:applications|employment-form-submissions)(?:\/|$)/.test(path))) {
      // Set before session resolution so even an anonymous 401 cannot be cached.
      res.setHeader("Cache-Control", "private, no-store");
    }
    const publicRequest = req.path === "/health" || req.path === "/healthz" ||
      (req.method === "POST" && ["/applications", "/employment-form-submissions", "/storage/uploads/request-url"].includes(req.path)) ||
      (req.query.download === undefined && isPublicBlankEmploymentTemplate(req.path, req.method)) ||
      isPublicBlankEmploymentEmail(req.path, req.method) ||
      (req.method === "GET" && req.path.startsWith("/storage/public-objects/"));
    if (publicRequest) { next(); return; }
    // The identity route owns all four structured failure responses, including
    // an absent/expired verified session and its durable diagnostic id.
    if (req.method === "GET" && req.path === "/staff/me") { next(); return; }
    if (req.method === "POST" && req.path === "/auth-diagnostics/events") { next(); return; }
    if (!(await resolveActor(req))) {
      if (isPromotedCandidateRequest(req.path, req.method, req.query) && await resolveCandidate(req)) {
        next();
        return;
      }
      res.status(401).json({ error: "Login session required" });
      return;
    }
    next();
  };
}
