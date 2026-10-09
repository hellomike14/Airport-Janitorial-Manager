import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import {
  CONFIDENTIAL_COOKIE,
  UNLOCK_MS,
  ConfidentialError,
  assertAdmin,
  assertOperationsManager,
  assertOperationsSupervisor,
  confidentialCookie,
  confidentialIdentity,
  confidentialService,
  personalOperationsAccessService,
} from "../lib/confidentialAccess";
const numericCode = z.string().regex(/^\d{8,12}$/);
const configureBody = z.object({ code: numericCode, confirmation: numericCode, currentCode: numericCode.optional() }).strict()
  .refine(body => body.code === body.confirmation);
export function confidentialFailure(error: unknown, res: Response) {
  if (error instanceof ConfidentialError) {
    res.status(error.status).json({ error: error.code, code: error.code, message: error.message }); return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "CONFIDENTIAL_CODE_INVALID", code: "CONFIDENTIAL_CODE_INVALID", message: "Use a matching 8–12 digit code and confirmation." }); return;
  }
  // Fail closed; never log request bodies, PINs, cookies or credential hashes.
  res.status(503).json({ error: "CONFIDENTIAL_UNAVAILABLE", code: "CONFIDENTIAL_UNAVAILABLE", message: "Confidential access is unavailable. Please retry." });
}
export function confidentialSameOrigin(req: Request) {
  const origin = req.get("origin");
  if (!origin) return; // server clients must still present verified manager identity
  const authorizedParty = getAuth(req)?.sessionClaims?.azp;
  let sameHost = false;
  try { sameHost = new URL(origin).host === req.get("host"); } catch { /* denied below */ }
  if (!sameHost && authorizedParty !== origin) throw new ConfidentialError(403, "ORIGIN_DENIED", "Confidential actions must start inside this app.");
}
const cookieOptions = (req: Request) => ({
  httpOnly: true, sameSite: "lax" as const, secure: req.secure || req.get("x-forwarded-proto")?.split(",")[0] === "https",
  path: "/api", maxAge: UNLOCK_MS,
});
const router = Router();
router.use("/confidential-access", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
router.use("/operations/confidential-access", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
router.use("/operations/personal-access", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
const action = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, _next: NextFunction) => {
  try { await fn(req, res); } catch (error) { confidentialFailure(error, res); }
};
router.get("/confidential-access/status", action(async (req, res) => {
  const identity = await confidentialIdentity(req); assertAdmin(identity);
  res.json(await confidentialService.status(identity, confidentialCookie(req)));
}));
router.post("/confidential-access/configure", action(async (req, res) => {
  const identity = await confidentialIdentity(req); assertAdmin(identity); confidentialSameOrigin(req);
  const body = configureBody.parse(req.body);
  const result = await confidentialService.configure(identity, confidentialCookie(req), body.code, body.currentCode);
  res.cookie(CONFIDENTIAL_COOKIE, result.token, cookieOptions(req));
  res.json(await confidentialService.status(identity, result.token));
}));
router.post("/confidential-access/unlock", action(async (req, res) => {
  const identity = await confidentialIdentity(req); assertAdmin(identity); confidentialSameOrigin(req);
  const { code } = z.object({ code: numericCode }).strict().parse(req.body);
  const result = await confidentialService.unlock(identity, code);
  res.cookie(CONFIDENTIAL_COOKIE, result.token, cookieOptions(req));
  res.json(await confidentialService.status(identity, result.token));
}));
router.post("/confidential-access/lock", action(async (req, res) => {
  const identity = await confidentialIdentity(req); assertAdmin(identity); confidentialSameOrigin(req);
  await confidentialService.lock(identity, confidentialCookie(req));
  res.clearCookie(CONFIDENTIAL_COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json(await confidentialService.status(identity, ""));
}));
router.get("/operations/confidential-access/status", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertAdmin(identity);
  res.json(await confidentialService.status(identity, confidentialCookie(req), true));
}));
router.post("/operations/confidential-access/unlock", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertAdmin(identity);
  confidentialSameOrigin(req);
  const { code } = z.object({ code: numericCode }).strict().parse(req.body);
  const result = await confidentialService.unlock(identity, code, true);
  res.cookie(CONFIDENTIAL_COOKIE, result.token, cookieOptions(req));
  res.json(await confidentialService.status(identity, result.token, true));
}));
router.post("/operations/confidential-access/lock", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertAdmin(identity);
  confidentialSameOrigin(req);
  await confidentialService.lock(identity, confidentialCookie(req), true);
  res.clearCookie(CONFIDENTIAL_COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json(await confidentialService.status(identity, "", true));
}));
router.get("/operations/personal-access/status", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertOperationsSupervisor(identity);
  res.json(await personalOperationsAccessService.status(identity, confidentialCookie(req), true));
}));
router.post("/operations/personal-access/configure", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertOperationsSupervisor(identity);
  confidentialSameOrigin(req);
  const body = configureBody.parse(req.body);
  const result = await personalOperationsAccessService.configure(identity, confidentialCookie(req), body.code, body.currentCode);
  res.cookie(CONFIDENTIAL_COOKIE, result.token, cookieOptions(req));
  res.json(await personalOperationsAccessService.status(identity, result.token, true));
}));
router.post("/operations/personal-access/unlock", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertOperationsSupervisor(identity);
  confidentialSameOrigin(req);
  const { code } = z.object({ code: numericCode }).strict().parse(req.body);
  const result = await personalOperationsAccessService.unlock(identity, code, true);
  res.cookie(CONFIDENTIAL_COOKIE, result.token, cookieOptions(req));
  res.json(await personalOperationsAccessService.status(identity, result.token, true));
}));
router.post("/operations/personal-access/lock", action(async (req, res) => {
  const identity = await confidentialIdentity(req);
  assertOperationsSupervisor(identity);
  confidentialSameOrigin(req);
  await personalOperationsAccessService.lock(identity, confidentialCookie(req), true);
  res.clearCookie(CONFIDENTIAL_COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json(await personalOperationsAccessService.status(identity, "", true));
}));
export default router;
