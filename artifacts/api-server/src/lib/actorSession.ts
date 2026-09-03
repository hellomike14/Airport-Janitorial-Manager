import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  isAppAccessDeniedEmail,
  verifiedPrimaryEmail,
} from "./loginIdentity";

// The acting staff member is derived from the verified Clerk session
// (session cookie verified by clerkMiddleware) and mapped to a staff record
// by email (case-insensitive). Identity-sensitive endpoints (e.g. messaging)
// must trust ONLY this server-derived identity — never client-sent staff ids.

export type StaffRow = typeof staffTable.$inferSelect;

export type ActorStaffResolution =
  | { status: "ok"; staff: StaffRow }
  | {
      status:
        | "unauthenticated"
        | "email_unverified"
        | "access_denied"
        | "no_staff_match"
        | "clerk_unavailable";
    };

// Small cache of Clerk userId -> primary email to avoid a Clerk API round
// trip on every request. Entries expire so email changes propagate.
const emailCache = new Map<string, { email: string | null; expiresAt: number }>();
const EMAIL_CACHE_TTL_MS = 60 * 1000;

async function emailForClerkUser(
  userId: string,
): Promise<{ status: "ok"; email: string } | { status: "email_unverified" | "clerk_unavailable" }> {
  const cached = emailCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.email
      ? { status: "ok", email: cached.email }
      : { status: "email_unverified" };
  }
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = verifiedPrimaryEmail(user);
  } catch (err) {
    console.error("Failed to fetch Clerk user for actor resolution:", err);
    return { status: "clerk_unavailable" };
  }
  // Cache only a usable identity. An address can become verified while a user
  // is on the sign-in screen, and caching the unverified state would keep that
  // newly verified user locked out for the full cache TTL.
  if (email) {
    emailCache.set(userId, { email, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });
  }
  if (emailCache.size > 500) {
    const now = Date.now();
    for (const [key, value] of emailCache) {
      if (value.expiresAt <= now) emailCache.delete(key);
    }
  }
  return email ? { status: "ok", email } : { status: "email_unverified" };
}

/**
 * Resolves the authenticated staff member for this request from the verified
 * Clerk session, matched to the staff table by email (case-insensitive).
 * Returns a status that distinguishes session, identity, authorization, and
 * upstream Clerk failures so callers can return an accurate HTTP response.
 */
export async function resolveActorStaffFromRequest(req: Request): Promise<ActorStaffResolution> {
  const auth = getAuth(req);
  if (!auth?.userId) return { status: "unauthenticated" };
  const clerkEmail = await emailForClerkUser(auth.userId);
  if (clerkEmail.status !== "ok") return clerkEmail;
  const { email } = clerkEmail;
  if (isAppAccessDeniedEmail(email)) return { status: "access_denied" };
  const [staff] = await db
    .select()
    .from(staffTable)
    .where(
      and(
        sql`lower(btrim(${staffTable.email})) = ${email}`,
        eq(staffTable.active, true),
        eq(staffTable.loginEnabled, true),
      ),
    )
    .limit(1);
  return staff ? { status: "ok", staff } : { status: "no_staff_match" };
}

export async function actorStaffFromRequest(req: Request): Promise<StaffRow | null> {
  const result = await resolveActorStaffFromRequest(req);
  return result.status === "ok" ? result.staff : null;
}

/** Returns the authenticated staff id derived from the Clerk session, or null. */
export async function actorIdFromRequest(req: Request): Promise<number | null> {
  const staff = await actorStaffFromRequest(req);
  return staff?.id ?? null;
}
