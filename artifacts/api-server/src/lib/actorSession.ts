import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

// The acting staff member is derived from the verified Clerk session
// (session cookie verified by clerkMiddleware) and mapped to a staff record
// by email (case-insensitive). Identity-sensitive endpoints (e.g. messaging)
// must trust ONLY this server-derived identity — never client-sent staff ids.

type StaffRow = typeof staffTable.$inferSelect;

// Small cache of Clerk userId -> primary email to avoid a Clerk API round
// trip on every request. Entries expire so email changes propagate.
const emailCache = new Map<string, { email: string | null; expiresAt: number }>();
const EMAIL_CACHE_TTL_MS = 60 * 1000;

async function emailForClerkUser(userId: string): Promise<string | null> {
  const cached = emailCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.email;
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
  } catch (err) {
    console.error("Failed to fetch Clerk user for actor resolution:", err);
    return null;
  }
  emailCache.set(userId, { email, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });
  return email;
}

/**
 * Resolves the authenticated staff member for this request from the verified
 * Clerk session, matched to the staff table by email (case-insensitive).
 * Returns null when there is no session, no email, or no matching active
 * staff record.
 */
export async function actorStaffFromRequest(req: Request): Promise<StaffRow | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;
  const email = await emailForClerkUser(auth.userId);
  if (!email) return null;
  const [staff] = await db
    .select()
    .from(staffTable)
    .where(sql`lower(${staffTable.email}) = ${email.toLowerCase()} AND ${staffTable.active} = true`)
    .limit(1);
  return staff ?? null;
}

/** Returns the authenticated staff id derived from the Clerk session, or null. */
export async function actorIdFromRequest(req: Request): Promise<number | null> {
  const staff = await actorStaffFromRequest(req);
  return staff?.id ?? null;
}
