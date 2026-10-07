/** A role is a permission, never proof that two staff records are one person. */
export function findSeedStaffIdentity<T extends { name: string; role: string; email?: string | null }>(
  existing: { name: string; role: string; email?: string | null },
  seeds: readonly T[],
): T | undefined {
  const named = seeds.find(seed => seed.name === existing.name);
  if (named) return named;
  const email = existing.email?.trim().toLowerCase();
  if (!email) return undefined;
  return seeds.find(seed => seed.role === existing.role && seed.email?.trim().toLowerCase() === email);
}
