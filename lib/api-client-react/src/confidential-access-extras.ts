import { customFetch } from "./custom-fetch";
import type { StaffMember } from "./generated/api.schemas";
const base = () => `${((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/").replace(/\/$/, "")}/api/confidential-access`;
export interface ConfidentialAccessState {
  configured: boolean; unlocked: boolean; expiresAt: string | null; lockedUntil: string | null; serverTime: string;
}
export const getConfidentialAccess = (signal?: AbortSignal) =>
  customFetch<ConfidentialAccessState>(`${base()}/status`, { signal, cache: "no-store", credentials: "include" });
const post = (path: string, body?: unknown) => customFetch<ConfidentialAccessState>(`${base()}/${path}`, {
  method: "POST", credentials: "include", cache: "no-store",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
});
export const configureConfidentialCode = (body: { code: string; confirmation: string; currentCode?: string }) => post("configure", body);
export const unlockConfidentialAccess = (code: string) => post("unlock", { code });
export const lockConfidentialAccess = () => post("lock");
export const getConfidentialStaffMembers = (signal?: AbortSignal) =>
  customFetch<StaffMember[]>(`${base().replace(/\/confidential-access$/, "")}/staff/confidential`, { signal, cache: "no-store", credentials: "include" });
