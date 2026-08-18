import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "marvol_gate";
// Shared company passcode for the entry gate. Only this universal passcode
// unlocks the facility — personal credentials are handled by Clerk sign-in.
const UNIVERSAL_GATE_PIN = process.env.GATE_UNIVERSAL_PIN || "0407";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PIN_REGEX = /^\d{4}$/;

function gateSecret(): string {
  return (
    process.env.GATE_SECRET ||
    process.env.SESSION_SECRET ||
    createHmac("sha256", "marvol-gate").update(process.env.DATABASE_URL || "dev").digest("hex")
  );
}

function sign(payload: string): string {
  return createHmac("sha256", gateSecret()).update(payload).digest("hex");
}

export function createGateToken(): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `gate.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyGateToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "gate") return false;
  const expiry = Number(parts[1]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = sign(`gate.${parts[1]}`);
  const given = parts[2];
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function gateTokenFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

// simple in-memory rate limiting per IP — many employees share the same
// facility IP, so only FAILED attempts count against the limit.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_ATTEMPTS = 50;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function setGateCookie(res: Response) {
  const token = createGateToken();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}${secure}`
  );
}

const router: IRouter = Router();

router.get("/status", (req: Request, res: Response) => {
  if (verifyGateToken(gateTokenFromRequest(req))) {
    res.json({ unlocked: true });
    return;
  }
  res.status(401).json({ unlocked: false });
});

router.post("/verify", (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  if (!PIN_REGEX.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }
  if (pin === UNIVERSAL_GATE_PIN) {
    setGateCookie(res);
    res.json({ unlocked: true });
    return;
  }
  recordFailure(ip);
  res.status(401).json({ error: "Incorrect passcode" });
});

export default router;
