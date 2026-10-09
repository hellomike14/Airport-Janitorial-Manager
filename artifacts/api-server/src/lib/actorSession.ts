import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { jobApplicationsTable, onboardingHiresTable, staffTable } from "@workspace/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { AuthServiceUnavailable, withAuthDeadline } from "./authAvailability";

// The acting staff member is derived from the verified Clerk session
// (session cookie verified by clerkMiddleware) and mapped to a staff record
// by email (case-insensitive). Identity-sensitive endpoints (e.g. messaging)
// must trust ONLY this server-derived identity — never client-sent staff ids.

type StaffRow = typeof staffTable.$inferSelect;
export type StaffIdentityResolution =
  | { status: "matched"; staff: StaffRow }
  | { status: "no_match" }
  | { status: "access_disabled" };

// Small cache of Clerk userId -> primary email to avoid a Clerk API round
// trip on every request. Entries expire so email changes propagate.
const emailCache = new Map<string, { email: string | null; expiresAt: number }>();
const EMAIL_CACHE_TTL_MS = 60 * 1000;
const emailRequests = new Map<string, Promise<string | null>>();
const verifiedEmailCache = new Map<string, { emails: string[]; expiresAt: number }>();
const verifiedEmailRequests = new Map<string, Promise<string[]>>();
const requestActors = new WeakMap<Request, Promise<StaffRow | null>>();
const requestResolutions = new WeakMap<Request, Promise<StaffIdentityResolution>>();
const requestCandidates = new WeakMap<Request, Promise<PromotedCandidateIdentity | null>>();

export type PromotedCandidateIdentity = {
  clerkUserId: string;
  hireId: number;
  applicationId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  position: string | null;
};

async function verifiedEmailsForClerkUser(userId: string): Promise<string[]> {
  const cached = verifiedEmailCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.emails;
  const pending = verifiedEmailRequests.get(userId);
  if (pending) return pending;
  const lookup = lookupVerifiedEmails(userId);
  verifiedEmailRequests.set(userId, lookup);
  try { return await lookup; }
  finally { verifiedEmailRequests.delete(userId); }
}

async function lookupVerifiedEmails(userId: string): Promise<string[]> {
  try {
    const user = await withAuthDeadline(clerkClient.users.getUser(userId));
    const emails = [...new Set(user.emailAddresses
      .filter(address => address.verification?.status === "verified")
      .map(address => address.emailAddress.trim().toLowerCase())
      .filter(Boolean))];
    if (verifiedEmailCache.size >= 1000) verifiedEmailCache.delete(verifiedEmailCache.keys().next().value!);
    verifiedEmailCache.set(userId, { emails, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });
    return emails;
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return [];
    console.error("Clerk verified-email lookup temporarily unavailable");
    throw new AuthServiceUnavailable();
  }
}

/**
 * Resolves an onboarding candidate only through a verified Clerk email and a
 * manager-created, audited hire-to-application link. Client-supplied identity
 * fields are never used to grant access.
 */
export async function promotedCandidateFromRequest(
  req: Request,
): Promise<PromotedCandidateIdentity | null> {
  const cached = requestCandidates.get(req);
  if (cached) return cached;
  const pending = resolvePromotedCandidate(req);
  requestCandidates.set(req, pending);
  return pending;
}

async function resolvePromotedCandidate(req: Request): Promise<PromotedCandidateIdentity | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;
  const verifiedEmails = await verifiedEmailsForClerkUser(auth.userId);
  if (verifiedEmails.length === 0) return null;
  try {
    const rows = await withAuthDeadline(db
      .select({
        hireId: onboardingHiresTable.id,
        applicationId: jobApplicationsTable.id,
        firstName: jobApplicationsTable.firstName,
        lastName: jobApplicationsTable.lastName,
        email: jobApplicationsTable.email,
        phone: jobApplicationsTable.phone,
        position: onboardingHiresTable.position,
      })
      .from(onboardingHiresTable)
      .innerJoin(jobApplicationsTable, eq(onboardingHiresTable.applicationId, jobApplicationsTable.id))
      .where(and(
        eq(jobApplicationsTable.status, "hired"),
        isNull(onboardingHiresTable.staffId),
        inArray(sql<string>`lower(btrim(${jobApplicationsTable.email}))`, verifiedEmails),
      ))
      .limit(2));
    const candidate = rows[0];
    const email = candidate?.email?.trim();
    if (rows.length !== 1 || !candidate || !email) return null;
    return {
      clerkUserId: auth.userId,
      hireId: candidate.hireId,
      applicationId: candidate.applicationId,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email,
      phone: candidate.phone,
      position: candidate.position,
    };
  } catch (error) {
    if (error instanceof AuthServiceUnavailable) throw error;
    console.error("Promoted candidate identity lookup temporarily unavailable");
    throw new AuthServiceUnavailable();
  }
}

async function emailForClerkUser(userId: string): Promise<string | null> {
  const cached = emailCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.email;
  const pending = emailRequests.get(userId);
  if (pending) return pending;
  const lookup = lookupEmail(userId);
  emailRequests.set(userId, lookup);
  try { return await lookup; }
  finally { emailRequests.delete(userId); }
}

async function lookupEmail(userId: string): Promise<string | null> {
  let email: string | null = null;
  try {
    const user = await withAuthDeadline(clerkClient.users.getUser(userId));
    email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    // Do not log provider payloads, credentials, or user email addresses.
    console.error("Clerk actor lookup temporarily unavailable");
    throw new AuthServiceUnavailable();
  }
  if (emailCache.size >= 1000) emailCache.delete(emailCache.keys().next().value!);
  emailCache.set(userId, { email, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });
  return email;
}

/**
 * Resolves the authenticated staff member for this request from the verified
 * Clerk session, matched to the staff table by email (case-insensitive).
 * Returns null when there is no session, no email, or no matching active
 * login-enabled staff record.
 */
export async function actorStaffFromRequest(req: Request): Promise<StaffRow | null> {
  const cached = requestActors.get(req);
  if (cached) return cached;
  const pending = resolveActor(req);
  requestActors.set(req, pending);
  return pending;
}

async function resolveActor(req: Request): Promise<StaffRow | null> {
  const resolution = await resolveStaffIdentity(req);
  return resolution.status === "matched" ? resolution.staff : null;
}

/**
 * Detailed identity resolution for /staff/me. actorStaffFromRequest remains
 * backward-compatible while this distinguishes an ineligible record from no match.
 */
export async function resolveStaffIdentity(req: Request): Promise<StaffIdentityResolution> {
  const cached = requestResolutions.get(req);
  if (cached) return cached;
  const pending = resolveStaffIdentityUncached(req);
  requestResolutions.set(req, pending);
  return pending;
}

async function resolveStaffIdentityUncached(req: Request): Promise<StaffIdentityResolution> {
  const auth = getAuth(req);
  if (!auth?.userId) return { status: "no_match" };
  const email = await emailForClerkUser(auth.userId);
  if (!email) return { status: "no_match" };
  try {
    const [staff] = await withAuthDeadline(db
      .select()
      .from(staffTable)
      .where(sql`lower(btrim(${staffTable.email})) = ${email.trim().toLowerCase()}`)
      .limit(1).then(rows => rows));
    if (!staff) return { status: "no_match" };
    if (!staff.active || !staff.loginEnabled || staff.formerEmployee) {
      return { status: "access_disabled" };
    }
    return { status: "matched", staff };
  } catch (error) {
    if (error instanceof AuthServiceUnavailable) throw error;
    console.error("Staff identity lookup temporarily unavailable");
    throw new AuthServiceUnavailable();
  }
}

/** Returns the authenticated staff id derived from the Clerk session, or null. */
export async function actorIdFromRequest(req: Request): Promise<number | null> {
  const staff = await actorStaffFromRequest(req);
  return staff?.id ?? null;
}
