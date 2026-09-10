import { useEffect, useState, type ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { useLocation } from "wouter";
import { LoginRecovery } from "./LoginRecovery";
import { BOOTSTRAP_RETRY_MS, BOOTSTRAP_SLOW_MS, claimBootstrapRetry, clearBootstrapRetry } from "../lib/authBootstrapRecovery";

/**
 * Only watches initial Clerk readiness, never staff resolution or credential
 * entry. A full reload resets the SDK's rejected script-loading promise.
 */
export function AuthBootstrapGate({ children }: { children: ReactNode }) {
  const { isLoaded } = useClerkAuth();
  const [path] = useLocation();
  const publicApplication = path === "/apply";
  const [phase, setPhase] = useState<"loading" | "slow" | "unavailable">("loading");

  useEffect(() => {
    if (isLoaded) {
      try { clearBootstrapRetry(window.sessionStorage); } catch { /* Storage can be disabled. */ }
      return;
    }
    // Never reload the public employment form or discard its in-progress input.
    if (publicApplication) return;
    setPhase("loading");
    let retryDue = false;
    let disposed = false;
    const attemptRecovery = () => {
      if (disposed || !retryDue || document.visibilityState !== "visible" || !navigator.onLine) return;
      let claimed = false;
      try { claimed = claimBootstrapRetry(window.sessionStorage); } catch { /* Manual retry remains available. */ }
      if (!claimed) {
        setPhase("unavailable");
        return;
      }
      disposed = true;
      // Fixed diagnostic code only: no identities, URLs, tokens, or user content.
      console.warn("[auth-bootstrap] automatic_retry");
      window.location.reload();
    };
    const slowTimer = setTimeout(() => setPhase("slow"), BOOTSTRAP_SLOW_MS);
    const retryTimer = setTimeout(() => {
      retryDue = true;
      setPhase("unavailable");
      attemptRecovery();
    }, BOOTSTRAP_RETRY_MS);
    window.addEventListener("online", attemptRecovery);
    document.addEventListener("visibilitychange", attemptRecovery);
    return () => {
      disposed = true;
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
      window.removeEventListener("online", attemptRecovery);
      document.removeEventListener("visibilitychange", attemptRecovery);
    };
  }, [isLoaded, publicApplication]);

  if (isLoaded || publicApplication) return children;
  return <LoginRecovery kind={phase === "unavailable" ? "bootstrap-error" : phase} />;
}