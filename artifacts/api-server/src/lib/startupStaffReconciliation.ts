import { normalizeLoginEmail } from "./loginIdentity";

export type StaffReconciliationCandidate = {
  id: number;
  email: string | null;
  active: boolean;
  loginEnabled: boolean;
};

/**
 * Select the single staff row that owns a seeded identity. Prefer the row
 * already carrying the expected Clerk email, then an enabled row, and finally
 * the lowest id for deterministic behavior across database executions.
 */
export function selectCanonicalStaffRecord<
  Candidate extends StaffReconciliationCandidate,
>(
  candidates: readonly Candidate[],
  expectedEmail?: string,
): Candidate | undefined {
  const normalizedExpected = expectedEmail
    ? normalizeLoginEmail(expectedEmail)
    : null;

  return [...candidates].sort((left, right) => {
    const leftEmailMatch =
      normalizedExpected !== null &&
      left.email !== null &&
      normalizeLoginEmail(left.email) === normalizedExpected;
    const rightEmailMatch =
      normalizedExpected !== null &&
      right.email !== null &&
      normalizeLoginEmail(right.email) === normalizedExpected;
    if (leftEmailMatch !== rightEmailMatch) return leftEmailMatch ? -1 : 1;

    const leftEnabled = left.active && left.loginEnabled;
    const rightEnabled = right.active && right.loginEnabled;
    if (leftEnabled !== rightEnabled) return leftEnabled ? -1 : 1;
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.id - right.id;
  })[0];
}
