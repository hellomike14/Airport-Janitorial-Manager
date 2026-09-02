import { isAppAccessDeniedEmail, normalizeLoginEmail } from "./loginIdentity";

export interface MessageRecipientCandidate {
  id: number;
  active: boolean;
  loginEnabled: boolean;
  email: string | null;
}

/**
 * A conversation recipient must represent a real app identity. This excludes
 * inactive staff, login-disabled contacts, and addresses that are retained
 * solely for external notifications.
 */
export function isMessageRecipientEligible(
  candidate: MessageRecipientCandidate,
): boolean {
  const email = candidate.email ? normalizeLoginEmail(candidate.email) : "";
  return (
    candidate.active &&
    candidate.loginEnabled &&
    email.length > 0 &&
    !isAppAccessDeniedEmail(email)
  );
}

export function invalidMessageRecipientIds(
  requestedIds: readonly number[],
  candidates: readonly MessageRecipientCandidate[],
): number[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return [...new Set(requestedIds)].filter((id) => {
    const candidate = byId.get(id);
    return !candidate || !isMessageRecipientEligible(candidate);
  });
}
