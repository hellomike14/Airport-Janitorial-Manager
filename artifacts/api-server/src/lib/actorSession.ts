import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { parseCookies } from "../routes/gate";

// Signed actor-session cookie identifying WHO is logged in (as opposed to the
// gate cookie, which only proves the shared facility passcode was entered).
// Minted on successful PIN verification (managers / staff with a PIN) and via
// POST /staff/session for PIN-less staff logins — mirroring the app's existing
// login trust model. Messaging endpoints require it so callers cannot act as
// another staff member by forging staffId/senderId in requests.

const COOKIE_NAME = "marvol_actor";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  return (
    process.env.GATE_SECRET ||
    process.env.SESSION_SECRET ||
    createHmac("sha256", "marvol-actor").update(process.env.DATABASE_URL || "dev").digest("hex")
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createActorToken(staffId: number): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `actor.${staffId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

export function setActorCookie(res: Response, staffId: number) {
  const token = createActorToken(staffId);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}${secure}`
  );
}

export function clearActorCookie(res: Response) {
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Returns the authenticated staff id from the actor cookie, or null. */
export function actorIdFromRequest(req: Request): number | null {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "actor") return null;
  const staffId = Number(parts[1]);
  const expiry = Number(parts[2]);
  if (!Number.isInteger(staffId) || staffId <= 0) return null;
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = sign(`actor.${parts[1]}.${parts[2]}`);
  const given = parts[3];
  if (expected.length !== given.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  } catch {
    return null;
  }
  return staffId;
}
