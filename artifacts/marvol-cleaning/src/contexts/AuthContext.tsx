import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { resolveStaffSession, type StaffIdentity } from "../lib/resolveStaffSession";

export type UserRole = StaffIdentity["role"];
export type ViewMode = UserRole;
export type CurrentUser = StaffIdentity;
export type StaffStatus = "signedOut" | "loading" | "nomatch" | "ok" | "expired" | "error";
interface AuthContextValue {
  currentUser: CurrentUser | null;
  staffStatus: StaffStatus;
  viewMode: ViewMode;
  logout: () => Promise<void>;
  retryStaff: () => void;
  setViewMode: (mode: ViewMode) => void;
  effectiveRole: ViewMode;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const BASE = import.meta.env.BASE_URL;
const basePath = BASE.replace(/\/$/, "");
type Snapshot = { owner: string; status: StaffStatus; user: CurrentUser | null; view: ViewMode };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = useClerkAuth();
  const { signOut } = useClerk();
  const owner = isSignedIn ? `${userId}:${sessionId}` : "";
  const [snapshot, setSnapshot] = useState<Snapshot>({ owner: "", status: "loading", user: null, view: "staff" });
  const [attempt, setAttempt] = useState(0);
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  const retryStaff = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !owner) {
      setSnapshot({ owner: "", status: "signedOut", user: null, view: "staff" });
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let activeRequest: AbortController | undefined;
    setSnapshot(previous => previous.owner === owner && previous.status === "ok" ? previous :
      { owner, status: "loading", user: null, view: "staff" });
    const resolve = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      activeRequest = new AbortController();
      const result = await resolveStaffSession({ url: `${BASE}api/staff/me`, getToken: fresh => tokenGetter.current({ skipCache: !!fresh }), signal: activeRequest.signal });
      inFlight = false;
      if (cancelled) return;
      setSnapshot(previous => {
        // A temporary connectivity failure must not evict a resolved worker
        // from the existing offline-capable session. Explicit revocation does.
        if (result.status === "error" && previous.owner === owner && previous.status === "ok") return previous;
        if (result.status !== "ok") return { owner, status: result.status, user: null, view: "staff" };
        const sameIdentity = previous.owner === owner && previous.user?.id === result.user.id && previous.user?.role === result.user.role;
        return { owner, status: "ok", user: result.user, view: sameIdentity ? previous.view : result.user.role };
      });
    };
    void resolve();
    const interval = setInterval(resolve, 20000);
    window.addEventListener("focus", resolve);
    window.addEventListener("online", resolve);
    return () => {
      cancelled = true;
      activeRequest?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", resolve);
      window.removeEventListener("online", resolve);
    };
  }, [isLoaded, isSignedIn, owner, attempt]);

  // Never expose the previous person's role while the new account is resolving.
  const matches = snapshot.owner === owner;
  const staffStatus: StaffStatus = !isLoaded ? "loading" : !isSignedIn ? "signedOut" : matches ? snapshot.status : "loading";
  const currentUser = matches && staffStatus === "ok" ? snapshot.user : null;
  const viewMode = currentUser ? snapshot.view : "staff";
  const logout = async () => {
    try { localStorage.removeItem("marvol_view_mode"); } catch { /* Storage can be disabled. */ }
    await signOut({ redirectUrl: `${basePath}/sign-in` });
    setSnapshot({ owner: "", status: "signedOut", user: null, view: "staff" });
  };
  const setViewMode = (mode: ViewMode) => {
    if (!currentUser || (currentUser.role !== "admin" && mode !== currentUser.role)) return;
    if (!["admin", "supervisor", "staff", "inspector"].includes(mode)) return;
    setSnapshot(previous => previous.owner === owner ? { ...previous, view: mode } : previous);
  };
  return <AuthContext.Provider value={{ currentUser, staffStatus, viewMode, logout, retryStaff, setViewMode, effectiveRole: viewMode }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
