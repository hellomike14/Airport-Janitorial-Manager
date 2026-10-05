type StaffLoginState = {
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
  email: string | null;
};

export function loginEnabledAfterAdminUpdate(
  current: StaffLoginState,
  update: { active?: boolean; email?: string | null },
): boolean {
  const active = update.active ?? current.active;
  const email = update.email === undefined ? current.email : update.email;

  if (!active || current.formerEmployee || !email?.trim()) return false;
  if (update.email !== undefined) return true;
  return current.loginEnabled;
}

export function loginEnabledAfterSeedReconciliation(input: {
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
  seedLoginEnabled?: boolean;
}): boolean {
  if (!input.active || input.formerEmployee || input.seedLoginEnabled === false) return false;
  return input.loginEnabled;
}