import React, { createContext, useContext, useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";

export type UserRole = "admin" | "supervisor" | "staff" | "inspector";
export type ViewMode = "admin" | "supervisor" | "staff" | "inspector";

export interface CurrentUser {
  id: number;
  name: string;
  role: UserRole;
  phone?: string | null;
  email?: string | null;
}

/**
 * - "signedOut": no Clerk session
 * - "loading":   Clerk session present, staff match in flight
 * - "nomatch":   Clerk account has no matching active staff record
 * - "ok":        staff record resolved
 */
export type StaffStatus = "signedOut" | "loading" | "nomatch" | "ok";

interface AuthContextValue {
  currentUser: CurrentUser | null;
  staffStatus: StaffStatus;
  viewMode: ViewMode;
  logout: () => void;
  setViewMode: (mode: ViewMode) => void;
  effectiveRole: ViewMode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const VIEW_MODE_KEY = "marvol_view_mode";
const BASE = import.meta.env.BASE_URL;
const basePath = BASE.replace(/\/$/, "");

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [staffStatus, setStaffStatus] = useState<StaffStatus>("loading");

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      return (stored as ViewMode) || "staff";
    } catch {
      return "staff";
    }
  });

  // Resolve (and keep fresh) the staff record matching the signed-in Clerk
  // account. The server derives the match from the verified Clerk session.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setCurrentUser(null);
      setStaffStatus("signedOut");
      return;
    }

    let cancelled = false;
    const resolveStaff = async () => {
      try {
        const res = await fetch(`${BASE}api/staff/me`, { credentials: "same-origin" });
        if (cancelled) return;
        if (res.ok) {
          const s = await res.json();
          if (cancelled) return;
          const user: CurrentUser = {
            id: s.id,
            name: s.name,
            role: s.role,
            phone: s.phone,
            email: s.email,
          };
          setCurrentUser((prev) => {
            if (!prev || prev.role !== user.role) {
              setViewModeState(user.role as ViewMode);
              localStorage.setItem(VIEW_MODE_KEY, user.role);
            }
            return user;
          });
          setStaffStatus("ok");
        } else if (res.status === 404) {
          setCurrentUser(null);
          setStaffStatus("nomatch");
        }
        // other statuses (e.g. gate 401, network blips): keep current state
      } catch {
        // ignore network errors
      }
    };

    setStaffStatus((prev) => (prev === "ok" ? prev : "loading"));
    resolveStaff();
    const interval = setInterval(resolveStaff, 20000);
    const onFocus = () => resolveStaff();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isLoaded, isSignedIn]);

  const logout = () => {
    localStorage.removeItem(VIEW_MODE_KEY);
    setCurrentUser(null);
    // Clerk owns the browser session — sign out through the client SDK.
    signOut({ redirectUrl: basePath || "/" });
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const effectiveRole = viewMode;

  return (
    <AuthContext.Provider
      value={{ currentUser, staffStatus, viewMode, logout, setViewMode, effectiveRole }}
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
