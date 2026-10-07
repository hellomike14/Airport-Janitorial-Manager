import { EmploymentFormsLibrary } from "./EmploymentFormsLibrary";
import { useAuth } from "@/contexts/AuthContext";

export function FormsTab() {
  const auth = useAuth();
  const identity = `${auth.currentUser?.id ?? ""}:${auth.effectiveRole}`;
  if (!auth.effectiveRole) return null;
  return <EmploymentFormsLibrary key={identity} />;
}
