import React, { createContext, useContext, useState, useEffect } from "react";

export type UserRole = "admin" | "supervisor" | "staff" | "inspector";
export type ViewMode = "admin" | "supervisor" | "staff" | "inspector";

export interface CurrentUser {
  id: number;
  name: string;
  role: UserRole;
  phone?: string | null;
  email?: string | null;
}

interface AuthContextValue {
  currentUser: CurrentUser | null;
  viewMode: ViewMode;
  login: (user: CurrentUser) => void;
  logout: () => void;
  setViewMode: (mode: ViewMode) => void;
  effectiveRole: ViewMode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "marvol_current_user";
const VIEW_MODE_KEY = "marvol_view_mode";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      return (stored as ViewMode) || "staff";
    } catch {
      return "staff";
    }
  });

  const login = (user: CurrentUser) => {
    setCurrentUser(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    const defaultMode = user.role as ViewMode;
    setViewModeState(defaultMode);
    localStorage.setItem(VIEW_MODE_KEY, defaultMode);
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VIEW_MODE_KEY);
    // Clear the server-side actor session so the next user at this browser
    // cannot act as the previous one.
    fetch(`${import.meta.env.BASE_URL}api/staff/logout`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {});
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  useEffect(() => {
    if (!currentUser) return;

    const refreshProfile = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/staff`);
        if (!res.ok) return;
        const list = await res.json();
        const fresh = Array.isArray(list) ? list.find((s: any) => s.id === currentUser.id) : null;
        if (!fresh) return;
        const changed =
          fresh.role !== currentUser.role ||
          fresh.name !== currentUser.name ||
          (fresh.phone || null) !== (currentUser.phone || null) ||
          (fresh.email || null) !== (currentUser.email || null);
        if (changed) {
          const updated: CurrentUser = {
            id: fresh.id,
            name: fresh.name,
            role: fresh.role,
            phone: fresh.phone,
            email: fresh.email,
          };
          setCurrentUser(updated);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          if (fresh.role !== currentUser.role) {
            setViewModeState(fresh.role as ViewMode);
            localStorage.setItem(VIEW_MODE_KEY, fresh.role);
          }
        }
      } catch {
        // ignore network errors
      }
    };

    refreshProfile();
    const interval = setInterval(refreshProfile, 20000);
    const onFocus = () => refreshProfile();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.name, currentUser?.phone, currentUser?.email]);

  const effectiveRole = viewMode;

  return (
    <AuthContext.Provider value={{ currentUser, viewMode, login, logout, setViewMode, effectiveRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
