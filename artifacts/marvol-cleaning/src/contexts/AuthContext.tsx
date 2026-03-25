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
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

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
