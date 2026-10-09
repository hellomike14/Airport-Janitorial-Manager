import type { Request, Response, NextFunction } from "express";
import {
  assertAdmin,
  assertOperationsManager,
  confidentialCookie,
  confidentialIdentity,
  confidentialService,
  personalOperationsAccessService,
} from "../lib/confidentialAccess";
import { confidentialFailure, confidentialSameOrigin } from "../routes/confidentialAccess";
import {
  isEmploymentFormObjectPath,
  isRestrictedEmploymentTemplatePath,
  isPublicBlankEmploymentTemplate,
} from "../routes/employmentForms";
import { db } from "@workspace/db";
import { objectUploadsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { ConfidentialIdentity } from "../lib/confidentialAccess";

type GateDependencies = {
  resolveIdentity: (req: Request) => Promise<ConfidentialIdentity | null>;
  requireUnlocked: (
    identity: ConfidentialIdentity,
    token: string,
    operationsScope?: boolean,
  ) => Promise<unknown>;
  isApplicationDocument: (objectPath: string) => Promise<boolean>;
};
const defaults: GateDependencies = {
  resolveIdentity: confidentialIdentity,
  requireUnlocked: (identity, token, operationsScope) =>
    operationsScope && identity.role === "supervisor"
      ? personalOperationsAccessService.require(identity, token, true)
      : confidentialService.require(identity, token, operationsScope),
  isApplicationDocument: async objectPath => {
    const [upload] = await db.select({ purpose: objectUploadsTable.purpose })
      .from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, objectPath)).limit(1);
    return upload?.purpose === "application_document";
  },
};

export function isConfidentialRequest(path: string, method: string) {
  // Express route matching is case-insensitive and decodes wildcard params.
  // Classify the same canonical path so encoded object URLs cannot skip the lock.
  try { path = decodeURIComponent(path); } catch { return true; }
  if (isPublicBlankEmploymentTemplate(path, method)) return false;
  if (isOperationsConfidentialRequest(path)) return true;
  if (/^\/applications(?:\/|$)/i.test(path)) return method !== "POST" || path.toLowerCase() !== "/applications";
  if (/^\/employment-form-submissions(?:\/|$)/i.test(path)) {
    return method !== "POST" || path.toLowerCase() !== "/employment-form-submissions";
  }
  if (/^\/(?:identity-documents|quickbooks|auth-diagnostics)(?:\/|$)/i.test(path)) return true;
  if (isRestrictedEmploymentTemplatePath(path, method)) return true;
  if (/^\/staff\/(?:confidential|former)(?:\/|$)/i.test(path)) return true;
  if (/^\/staff(?:\/|$)/i.test(path) && !["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const prefix = "/storage/objects/";
  if (path.toLowerCase().startsWith(prefix)) {
    const objectPath = `/objects/${path.slice(prefix.length)}`;
     return objectPath.startsWith("/objects/hr-identity/") ||
       objectPath.startsWith("/objects/petty-cash/receipts/") ||
       objectPath.startsWith("/objects/petty-cash/receipts-staging/") ||
       isEmploymentFormObjectPath(objectPath);
  }
  return false;
}
export function isEmployeeAdministratorRequest(path: string, method: string) {
  try { path = decodeURIComponent(path); } catch { return false; }
  const upperMethod = method.toUpperCase();
  return (upperMethod === "GET" && /^\/employment-form-submissions\/?$/i.test(path)) ||
    (upperMethod === "PATCH" && /^\/employment-form-submissions\/\d+\/review\/?$/i.test(path)) ||
    (upperMethod === "POST" && /^\/staff\/?$/i.test(path)) ||
    (upperMethod === "PUT" && /^\/staff\/\d+\/?$/i.test(path));
}
export function isOperationsConfidentialRequest(path: string) {
  try {
    path = decodeURIComponent(path);
  } catch {
    return true;
  }
  return /^\/operations\/(?:petty-cash|uniform-stock)(?:\/|$)/i.test(path) ||
    /^\/operations\/workbooks\/uniform$/i.test(path);
}
export function createConfidentialAreasMiddleware(overrides: Partial<GateDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request, res: Response, next: NextFunction) => {
    let applicationDocument = false;
    try {
      const decoded = decodeURIComponent(req.path);
      if ((req.method === "GET" || req.method === "HEAD") && decoded.toLowerCase().startsWith("/storage/objects/") &&
          !isPublicBlankEmploymentTemplate(decoded, req.method)) {
        applicationDocument = await deps.isApplicationDocument(`/objects/${decoded.slice("/storage/objects/".length)}`);
      }
    } catch (error) { confidentialFailure(error, res); return; }
    if (!applicationDocument && !isConfidentialRequest(req.path, req.method)) { next(); return; }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const operationsScope = isOperationsConfidentialRequest(req.path);
      const identity = await deps.resolveIdentity(req);
      if (identity?.role === "employee_administrator" &&
          isEmployeeAdministratorRequest(req.path, req.method)) {
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) confidentialSameOrigin(req);
        next();
        return;
      }
      if (operationsScope) assertOperationsManager(identity);
      else assertAdmin(identity);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) confidentialSameOrigin(req);
      await deps.requireUnlocked(identity, confidentialCookie(req), operationsScope);
      next();
    } catch (error) { confidentialFailure(error, res); }
  };
}
export const confidentialAreas = createConfidentialAreasMiddleware();
