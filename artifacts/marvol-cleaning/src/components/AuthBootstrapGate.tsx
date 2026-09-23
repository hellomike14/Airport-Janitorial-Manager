import { useEffect, useState, type ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { useLocation } from "wouter";
import { LoginRecovery } from "./LoginRecovery";
import { BOOTSTRAP_RETRY_MS, BOOTSTRAP_SLOW_MS, claimBootstrapRetry, clearBootstrapRetry } from "../lib/authBootstrapRecovery";
import { reportAuthDiagnostic } from "../lib/authDiagnosticsApi";

/**
 * Only watches initial Clerk readiness, never staff resolution or credential
 * entry. A full reload resets the SDK's rejected script-loading promise.
 */
export function AuthBootstrapGate({ children }: { children: ReactNode }) {
  const { isLoaded } = useClerkAuth();
  const [path] = useLocation();
  const publicApplication = path === "/apply";
  const [phase, setPhase] = useState<"loading" | "slow" | "unavailable">("loading");
  const [diagnosticId, setDiagnosticId] = useState<string | undefined>(() => {
    try { return window.sessionStorage.getItem("marvol:auth-bootstrap-diagnostic-id") ?? undefined; }
    catch { return undefined; }
  });

  useEffect(() => {
    if (isLoaded) {
      try { clearBootstrapRetry(window.sessionStorage); } catch { /* Storage can be disabled. */ }
      try { window.sessionStorage.removeItem("marvol:auth-bootstrap-timeout-reported"); } catch { /* Storage can be disabled. */ }
      try { window.sessionStorage.removeItem("marvol:auth-bootstrap-diagnostic-id"); } catch { /* Storage can be disabled. */ }
      return;
    }
    // Never reload the public employment form or discard its in-progress input.
    if (publicApplication) return;
    setPhase("loading");
    let retryDue = false;
    let disposed = false;
    const reportBootstrapTimeout = () => {
      let shouldReport = true;
      try {
        shouldReport = window.sessionStorage.getItem("marvol:auth-bootstrap-timeout-reported") !== "reported";
        if (shouldReport) window.sessionStorage.setItem("marvol:auth-bootstrap-timeout-reported", "reported");
      } catch { /* This mounted gate still reports only once. */ }
      if (!shouldReport) return;
      void reportAuthDiagnostic("AUTH_SERVICE_UNAVAILABLE")
        .then(id => {
          if (!id) return;
          try { window.sessionStorage.setItem("marvol:auth-bootstrap-diagnostic-id", id); } catch { /* Storage is optional. */ }
          if (!disposed) setDiagnosticId(id);
        })
        .catch(() => { /* Telemetry must never block automatic recovery. */ });
    };
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
    const slowTimer = setTimeout(() => {
      setPhase("slow");
      reportBootstrapTimeout();
    }, BOOTSTRAP_SLOW_MS);
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
  return <LoginRecovery kind={phase === "unavailable" ? "bootstrap-error" : phase} diagnosticId={diagnosticId} />;
}