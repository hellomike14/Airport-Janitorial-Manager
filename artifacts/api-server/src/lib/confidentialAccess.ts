import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { confidentialSettingsTable as settings, confidentialAttemptsTable as attempts, confidentialGrantsTable as grants, confidentialEventsTable as events } from "@workspace/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { actorStaffFromRequest } from "./actorSession";

export const CONFIDENTIAL_COOKIE = "marvol_confidential";
export const UNLOCK_MS = 30 * 60_000;
const WINDOW_MS = 15 * 60_000;
export type ConfidentialIdentity = { staffId: number; sessionId: string; role: string };
const OPERATIONS_SUPERVISOR_STAFF_ID: Readonly<Record<string, number>> = {
  development: 18,
  production: 1,
};
export class ConfidentialError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const derive = (code: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(code, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashConfidentialCode(code: string) {
  const salt = randomBytes(24).toString("hex");
  return `${salt}:${(await derive(code, salt)).toString("hex")}`;
}
export async function matchesConfidentialCode(code: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected || expected.length !== 128) return false;
  return timingSafeEqual(await derive(code, salt), Buffer.from(expected, "hex"));
}
export async function confidentialIdentity(req: Request): Promise<ConfidentialIdentity | null> {
  const actor = await actorStaffFromRequest(req);
  // clerkMiddleware populates req.auth from the verified Clerk session. Read
  // its session id directly so this identity helper shares the same
  // server-derived session bridge as the route middleware.
  const serverAuth = (req as Request & { auth?: { sessionId?: string | null } }).auth;
  const sessionId = serverAuth?.sessionId ?? getAuth(req)?.sessionId;
  return actor && sessionId ? { staffId: actor.id, role: actor.role, sessionId } : null;
}
export function confidentialCookie(req: Request) {
  const pair = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${CONFIDENTIAL_COOKIE}=`));
  const token = pair?.slice(CONFIDENTIAL_COOKIE.length + 1) ?? "";
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}
export function assertAdmin(identity: ConfidentialIdentity | null): asserts identity is ConfidentialIdentity {
  if (!identity) throw new ConfidentialError(401, "SESSION_REQUIRED", "Sign in again.");
  if (identity.role !== "admin") throw new ConfidentialError(403, "ADMIN_REQUIRED", "Only administrators may access confidential areas.");
}
export function isOperationsSupervisor(identity: Pick<ConfidentialIdentity, "staffId" | "role">, environment = process.env.NODE_ENV) {
  return identity.role === "supervisor" &&
    OPERATIONS_SUPERVISOR_STAFF_ID[environment ?? ""] === identity.staffId;
}
export function isOperationsManager(identity: Pick<ConfidentialIdentity, "staffId" | "role">, environment = process.env.NODE_ENV) {
  return identity.role === "admin" || isOperationsSupervisor(identity, environment);
}
export function assertOperationsSupervisor(identity: ConfidentialIdentity | null): asserts identity is ConfidentialIdentity {
  if (!identity) throw new ConfidentialError(401, "SESSION_REQUIRED", "Sign in again.");
  if (!isOperationsSupervisor(identity)) {
    throw new ConfidentialError(403, "OPERATIONS_SUPERVISOR_REQUIRED", "This personal Operations access is limited to the verified Operations supervisor.");
  }
}
export function assertOperationsManager(identity: ConfidentialIdentity | null): asserts identity is ConfidentialIdentity {
  if (!identity) throw new ConfidentialError(401, "SESSION_REQUIRED", "Sign in again.");
  if (!isOperationsManager(identity)) {
    throw new ConfidentialError(403, "MANAGER_REQUIRED", "Only administrators and the verified Operations supervisor may access protected Operations records.");
  }
}
type QueryDb = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
export function createConfidentialService(settingsId = 1, personalSupervisorOnly = false) {
  const attemptWhere = (identity: ConfidentialIdentity) => and(eq(attempts.settingsId, settingsId), eq(attempts.staffId, identity.staffId));
  const config = async (conn: QueryDb = db) => (await conn.select().from(settings).where(eq(settings.id, settingsId)))[0];
  const assertCredentialOwner = (identity: ConfidentialIdentity | null) => {
    if (personalSupervisorOnly) assertOperationsSupervisor(identity);
    else assertAdmin(identity);
  };
  const grant = async (identity: ConfidentialIdentity, token: string, version: number, conn: QueryDb = db) => {
    if (!token) return undefined;
    return (await conn.select().from(grants).where(and(
      eq(grants.tokenHash, digest(token)), eq(grants.settingsId, settingsId), eq(grants.staffId, identity.staffId),
      eq(grants.sessionHash, digest(identity.sessionId)), eq(grants.version, version), gt(grants.expiresAt, new Date()),
    )))[0];
  };
  const event = (identity: ConfidentialIdentity, action: string) => ({ id: randomUUID(), settingsId, staffId: identity.staffId, action });
  const issue = async (conn: QueryDb, identity: ConfidentialIdentity, version: number) => {
    const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + UNLOCK_MS);
    await conn.delete(grants).where(and(eq(grants.settingsId, settingsId), eq(grants.staffId, identity.staffId), eq(grants.sessionHash, digest(identity.sessionId))));
    await conn.insert(grants).values({ settingsId, tokenHash: digest(token), staffId: identity.staffId, sessionHash: digest(identity.sessionId), version, expiresAt });
    await conn.delete(attempts).where(attemptWhere(identity));
    return { token, expiresAt };
  };
  // All credential checks serialize in Postgres, including across app instances.
  // Failed checks RETURN their error so the attempt/audit transaction commits.
  const check = async (conn: QueryDb, identity: ConfidentialIdentity, code: string, encoded: string) => {
    const now = new Date();
    const [previous] = await conn.select().from(attempts).where(attemptWhere(identity));
    if (previous?.lockedUntil && previous.lockedUntil > now) return new ConfidentialError(429, "CONFIDENTIAL_RATE_LIMIT", "Too many incorrect attempts. Wait 15 minutes before trying again.");
    if (await matchesConfidentialCode(code, encoded)) return null;
    const withinWindow = previous && now.getTime() - previous.windowStart.getTime() < WINDOW_MS;
    const failures = withinWindow ? previous.failures + 1 : 1;
    const lockedUntil = failures >= 5 ? new Date(now.getTime() + WINDOW_MS) : null;
    await conn.insert(attempts).values({ settingsId, staffId: identity.staffId, failures, windowStart: withinWindow ? previous.windowStart : now, lockedUntil })
      .onConflictDoUpdate({ target: [attempts.settingsId, attempts.staffId], set: { failures, windowStart: withinWindow ? previous.windowStart : now, lockedUntil } });
    await conn.insert(events).values(event(identity, "unlock_failed"));
    return new ConfidentialError(lockedUntil ? 429 : 401, lockedUntil ? "CONFIDENTIAL_RATE_LIMIT" : "CONFIDENTIAL_CODE_WRONG",
      lockedUntil ? "Too many incorrect attempts. Wait 15 minutes before trying again." : "The access code is incorrect.");
  };
  return {
    async status(identity: ConfidentialIdentity, token: string, operationsScope = false) {
      if (operationsScope) assertOperationsManager(identity);
      else assertAdmin(identity);
      const current = await config();
      const active = current?.codeHash ? await grant(identity, token, current.version) : undefined;
      const [attempt] = await db.select().from(attempts).where(attemptWhere(identity));
      return { configured: !!current?.codeHash, unlocked: !!active, expiresAt: active?.expiresAt.toISOString() ?? null,
        lockedUntil: attempt?.lockedUntil && attempt.lockedUntil > new Date() ? attempt.lockedUntil.toISOString() : null, serverTime: new Date().toISOString() };
    },
    async require(identity: ConfidentialIdentity, token: string, operationsScope = false) {
      if (operationsScope) assertOperationsManager(identity);
      else assertAdmin(identity);
      const current = await config();
      const active = current?.codeHash ? await grant(identity, token, current.version) : undefined;
      if (!active) throw new ConfidentialError(
        423,
        "CONFIDENTIAL_LOCKED",
        operationsScope
          ? "Unlock protected Operations records with the confidential access code."
          : "Unlock confidential areas with the administrator access code.",
      );
      return active;
    },
    async configure(identity: ConfidentialIdentity, token: string, code: string, currentCode?: string) {
      assertCredentialOwner(identity);
      if (!/^\d{8,12}$/.test(code)) throw new ConfidentialError(400, "CONFIDENTIAL_CODE_INVALID", "Use an 8–12 digit access code.");
      if (/^(\d)\1+$/.test(code) || ["12345678", "87654321", "01234567", "76543210"].includes(code)) {
        throw new ConfidentialError(400, "CONFIDENTIAL_CODE_WEAK", "Choose a less predictable 8–12 digit code.");
      }
      const result = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(913503, 0)`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(913503, ${settingsId})`);
        await tx.insert(settings).values({ id: settingsId }).onConflictDoNothing();
        const current = (await config(tx))!;
        if (current.codeHash) {
          if (!await grant(identity, token, current.version, tx)) return new ConfidentialError(423, "CONFIDENTIAL_LOCKED", "Unlock before changing the access code.");
          if (!currentCode || !/^\d{8,12}$/.test(currentCode)) return new ConfidentialError(400, "CURRENT_CODE_REQUIRED", "Enter the current access code.");
          const error = await check(tx, identity, currentCode, current.codeHash);
          if (error) return error;
        }
        const [otherSettings] = await tx.select().from(settings)
          .where(eq(settings.id, settingsId === 1 ? 2 : 1));
        if (otherSettings?.codeHash && await matchesConfidentialCode(code, otherSettings.codeHash)) {
          return new ConfidentialError(409, "CONFIDENTIAL_CODE_REUSED", "The administrator and personal Operations codes must be different.");
        }
        const version = current.version + 1;
        await tx.update(settings).set({ codeHash: await hashConfidentialCode(code), version, updatedAt: new Date() }).where(eq(settings.id, settingsId));
        await tx.delete(grants).where(eq(grants.settingsId, settingsId));
        await tx.insert(events).values(event(identity, current.codeHash ? "code_changed" : "code_configured"));
        return issue(tx, identity, version);
      });
      if (result instanceof ConfidentialError) throw result;
      return result;
    },
    async unlock(identity: ConfidentialIdentity, code: string, operationsScope = false) {
      if (operationsScope) assertOperationsManager(identity);
      else assertCredentialOwner(identity);
      if (!/^\d{8,12}$/.test(code)) throw new ConfidentialError(400, "CONFIDENTIAL_CODE_INVALID", "Use an 8–12 digit access code.");
      const result = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(913503, ${settingsId})`);
        const current = await config(tx);
        if (!current?.codeHash) return new ConfidentialError(409, "CONFIDENTIAL_CODE_UNSET", "An administrator must set up the access code first.");
        const error = await check(tx, identity, code, current.codeHash);
        if (error) return error;
        await tx.insert(events).values(event(identity, "unlocked"));
        return issue(tx, identity, current.version);
      });
      if (result instanceof ConfidentialError) throw result;
      return result;
    },
    async lock(identity: ConfidentialIdentity, token: string, operationsScope = false) {
      if (operationsScope) assertOperationsManager(identity);
      else assertCredentialOwner(identity);
      // Bind revocation to this actor/session, not just a supplied token.
      await db.delete(grants).where(and(eq(grants.settingsId, settingsId), eq(grants.staffId, identity.staffId), eq(grants.sessionHash, digest(identity.sessionId))));
      if (await config()) await db.insert(events).values(event(identity, "locked"));
    },
    async startQuickbooks(identity: ConfidentialIdentity, token: string) {
      const active = await this.require(identity, token);
      const state = randomBytes(32).toString("hex");
      await db.update(grants).set({ quickbooksStateHash: digest(state) }).where(eq(grants.tokenHash, active.tokenHash));
      return state;
    },
    async consumeQuickbooks(identity: ConfidentialIdentity, token: string, state: string) {
      const active = await this.require(identity, token);
      const changed = await db.update(grants).set({ quickbooksStateHash: null }).where(and(eq(grants.tokenHash, active.tokenHash), eq(grants.quickbooksStateHash, digest(state)))).returning({ id: grants.tokenHash });
      if (!changed.length) throw new ConfidentialError(403, "OAUTH_STATE_INVALID", "QuickBooks connection expired or did not start in this administrator session.");
    },
  };
}
export const confidentialService = createConfidentialService();
export const personalOperationsAccessService = createConfidentialService(2, true);
