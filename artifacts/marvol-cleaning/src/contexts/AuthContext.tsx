import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/react";
import { purgeOfflineUserData } from "@/lib/offlineStore";

export type UserRole = "admin" | "supervisor" | "staff" | "inspector";
export type ViewMode = "admin" | "supervisor" | "staff" | "inspector";

export interface CurrentUser {
  id: number;
  name: string;
  role: UserRole;
}

/**
 * - "signedOut": no Clerk session
 * - "loading":   Clerk session present, staff match in flight
 * - "nomatch":   Clerk account has no matching active staff record
 * - "error":     the staff lookup failed and can be retried
 * - "ok":        staff record resolved
 */
export type StaffStatus = "signedOut" | "loading" | "nomatch" | "error" | "ok";
export type StaffErrorReason = "session" | "forbidden" | "network" | "server";

interface AuthContextValue {
  currentUser: CurrentUser | null;
  staffStatus: StaffStatus;
  staffError: StaffErrorReason | null;
  viewMode: ViewMode;
  logout: () => Promise<void>;
  retryStaff: () => void;
  setViewMode: (mode: ViewMode) => void;
  effectiveRole: ViewMode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const VIEW_MODE_KEY = "marvol_view_mode";
const BASE = import.meta.env.BASE_URL;
const basePath = BASE.replace(/\/$/, "");

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "supervisor" || value === "staff" || value === "inspector";
}

function readStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return isUserRole(stored) ? stored : "staff";
  } catch {
    return "staff";
  }
}

function storeViewMode(mode: ViewMode | null) {
  try {
    if (mode === null) localStorage.removeItem(VIEW_MODE_KEY);
    else localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Storage can be unavailable in private browsing or locked-down webviews.
  }
}

function parseCurrentUser(value: unknown): CurrentUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "number" ||
    !Number.isInteger(candidate.id) ||
    typeof candidate.name !== "string" ||
    candidate.name.trim() === "" ||
    !isUserRole(candidate.role)
  ) {
    return null;
  }
  return { id: candidate.id, name: candidate.name, role: candidate.role };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [lookupClerkUserId, setLookupClerkUserId] = useState<string | null>(null);
  const [staffStatus, setStaffStatus] = useState<StaffStatus>("loading");
  const [staffError, setStaffError] = useState<StaffErrorReason | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const [viewMode, setViewModeState] = useState<ViewMode>(readStoredViewMode);

  const retryStaff = useCallback(() => {
    setRetryVersion((version) => version + 1);
  }, []);

  // Resolve (and keep fresh) the staff record matching the signed-in Clerk
  // account. The server derives the match from the verified Clerk session.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !clerkUser?.id) {
      setCurrentUser(null);
      setLookupClerkUserId(null);
      setStaffError(null);
      setStaffStatus("signedOut");
      return;
    }

    let cancelled = false;
    let hasVerifiedStaff = false;
    let activeRequest: AbortController | null = null;

    // Never render a previous Clerk account with the next account's session.
    setCurrentUser(null);
    setLookupClerkUserId(null);
    setStaffError(null);
    setStaffStatus("loading");

    const resolveStaff = async () => {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      let requestTimedOut = false;
      const timeout = window.setTimeout(() => {
        requestTimedOut = true;
        controller.abort();
      }, 15_000);

      try {
        const res = await fetch(`${BASE}api/staff/me`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.ok) {
          const user = parseCurrentUser(await res.json());
          if (cancelled) return;
          if (!user) {
            if (!hasVerifiedStaff) {
              setCurrentUser(null);
              setLookupClerkUserId(clerkUser.id);
              setStaffError("server");
              setStaffStatus("error");
            }
            return;
          }

          hasVerifiedStaff = true;
          setLookupClerkUserId(clerkUser.id);
          setCurrentUser((prev) => {
            if (!prev || prev.role !== user.role) {
              setViewModeState(user.role);
              storeViewMode(user.role);
            }
            return user;
          });
          setStaffError(null);
          setStaffStatus("ok");
        } else if (res.status === 404) {
          hasVerifiedStaff = false;
          setCurrentUser(null);
          setLookupClerkUserId(clerkUser.id);
          setStaffError(null);
          setStaffStatus("nomatch");
        } else if (res.status === 401 || res.status === 403) {
          hasVerifiedStaff = false;
          setCurrentUser(null);
          setLookupClerkUserId(clerkUser.id);
          setStaffError(res.status === 401 ? "session" : "forbidden");
          setStaffStatus("error");
        } else if (!hasVerifiedStaff) {
          setCurrentUser(null);
          setLookupClerkUserId(clerkUser.id);
          setStaffError("server");
          setStaffStatus("error");
        }
      } catch (error) {
        if (cancelled) return;
        if (
          error instanceof DOMException &&
          error.name === "AbortError" &&
          !requestTimedOut
        ) {
          return;
        }
        // A background connectivity blip must not eject an already verified
        // staff member from the offline-capable app. Initial lookup failures,
        // however, need a visible recovery screen instead of an endless spinner.
        if (!hasVerifiedStaff) {
          setCurrentUser(null);
          setLookupClerkUserId(clerkUser.id);
          setStaffError("network");
          setStaffStatus("error");
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeRequest === controller) activeRequest = null;
      }
    };

    resolveStaff();
    const interval = setInterval(resolveStaff, 20000);
    const onFocus = () => resolveStaff();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      activeRequest?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [clerkUser?.id, isLoaded, isSignedIn, retryVersion]);

  const logout = async () => {
    storeViewMode(null);
    setCurrentUser(null);
    setLookupClerkUserId(null);
    setStaffError(null);
    setStaffStatus("signedOut");
    try {
      await purgeOfflineUserData();
    } catch (error) {
      console.warn("[Auth] Failed to purge offline user data during sign-out:", error);
    }
    // Clerk owns the browser session — sign out through the client SDK.
    try {
      await signOut({ redirectUrl: basePath || "/" });
    } catch (error) {
      console.error("[Auth] Clerk sign-out failed:", error);
      setLookupClerkUserId(clerkUser?.id ?? null);
      setStaffError("session");
      setStaffStatus("error");
    }
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    storeViewMode(mode);
  };

  const effectiveRole = viewMode;
  const sessionMatchesLookup = Boolean(
    isSignedIn && clerkUser?.id && clerkUser.id === lookupClerkUserId,
  );
  const visibleCurrentUser = sessionMatchesLookup && staffStatus === "ok" ? currentUser : null;
  const visibleStaffStatus: StaffStatus =
    isLoaded && isSignedIn && !sessionMatchesLookup ? "loading" : staffStatus;

  return (
    <AuthContext.Provider
      value={{
        currentUser: visibleCurrentUser,
        staffStatus: visibleStaffStatus,
        staffError,
        viewMode,
        logout,
        retryStaff,
        setViewMode,
        effectiveRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
