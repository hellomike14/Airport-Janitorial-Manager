export const APP_ACCESS_DENIED_EMAILS = new Set([
  "msutherland@marvolenterprises.com",
]);

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAppAccessDeniedEmail(email: string): boolean {
  return APP_ACCESS_DENIED_EMAILS.has(normalizeLoginEmail(email));
}

type ClerkEmailAddressLike = {
  id: string;
  emailAddress: string;
  verification?: { status?: string | null } | null;
};

type ClerkUserEmailLike = {
  primaryEmailAddressId?: string | null;
  emailAddresses: ClerkEmailAddressLike[];
};

/**
 * Return only Clerk's verified primary address. Falling back to an arbitrary
 * secondary or unverified address would let a tenant configuration change
 * turn possession of a session into possession of a staff identity.
 */
export function verifiedPrimaryEmail(user: ClerkUserEmailLike): string | null {
  if (!user.primaryEmailAddressId) return null;
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  if (!primary || primary.verification?.status !== "verified") return null;
  const normalized = normalizeLoginEmail(primary.emailAddress);
  return normalized || null;
}
