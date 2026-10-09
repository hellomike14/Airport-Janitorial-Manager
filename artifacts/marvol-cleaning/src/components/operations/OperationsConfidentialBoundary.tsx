import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";
import { isSensitiveKey, isValidCode } from "@/lib/confidentialLogic";

type OperationsAccessStatus = {
  configured: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  lockedUntil: string | null;
  serverTime: string;
};

const endpoint = "/api/operations/confidential-access";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tracking-widest text-slate-900";

async function readStatus(signal?: AbortSignal): Promise<OperationsAccessStatus> {
  const response = await fetch(`${endpoint}/status`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Unable to check protected Operations access.");
  }
  return data as OperationsAccessStatus;
}

function SupervisorOperationsBoundary({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OperationsAccessStatus | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const purgeSensitive = useCallback(() => {
    const predicate = (query: { queryKey: readonly unknown[] }) =>
      isSensitiveKey(query.queryKey);
    void queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  useEffect(() => {
    let stopped = false;
    let activeRequest: AbortController | undefined;
    const refresh = async () => {
      activeRequest?.abort();
      activeRequest = new AbortController();
      try {
        const current = await readStatus(activeRequest.signal);
        if (stopped) return;
        setStatus(current);
        setError("");
        if (!current.unlocked) purgeSensitive();
      } catch (cause) {
        if (stopped || (cause as Error)?.name === "AbortError") return;
        setStatus(null);
        setError(cause instanceof Error ? cause.message : "Access check failed.");
        purgeSensitive();
      }
    };
    if (!currentUser?.id) {
      setStatus(null);
      purgeSensitive();
      return () => {
        stopped = true;
        activeRequest?.abort();
      };
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      stopped = true;
      activeRequest?.abort();
      window.clearInterval(timer);
      purgeSensitive();
    };
  }, [currentUser?.id, purgeSensitive]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidCode(code)) {
      setError("Enter the 8–12 digit Operations access code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/unlock`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "The access code could not be checked.");
      }
      setStatus(data as OperationsAccessStatus);
      setCode("");
    } catch (cause) {
      setStatus(null);
      purgeSensitive();
      setError(cause instanceof Error ? cause.message : "The access code could not be checked.");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/lock`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Unable to lock Operations records.");
      }
      setStatus(data as OperationsAccessStatus);
      purgeSensitive();
    } catch (cause) {
      setStatus(null);
      purgeSensitive();
      setError(cause instanceof Error ? cause.message : "Unable to lock Operations records.");
    } finally {
      setBusy(false);
    }
  };

  if (status?.unlocked) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void lock()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 print:hidden"
          >
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            Lock Operations records
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {children}
      </div>
    );
  }

  return (
    <section
      className="mx-auto my-6 max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      data-testid="operations-confidential-gate"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-800 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Protected Operations records</h2>
          <p className="text-sm text-slate-500">Manager access is time-limited.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {!status && !error && <p className="text-sm text-slate-600">Checking access…</p>}
      {status && !status.configured && (
        <p className="text-sm text-slate-600">
          An administrator must set up the confidential access code before a supervisor can unlock these records.
        </p>
      )}
      {status?.configured && (
        <form onSubmit={(event) => void unlock(event)} className="space-y-3">
          {status.lockedUntil && (
            <p role="alert" className="text-sm text-rose-700">
              Too many incorrect attempts. Access is temporarily locked.
            </p>
          )}
          <label className="block space-y-1 text-sm font-medium text-slate-700">
            <span>Operations access code</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              maxLength={12}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 12))
              }
              className={inputClass}
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || !!status.lockedUntil || !isValidCode(code)}
            className="w-full rounded-md bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Checking…" : "Unlock Operations records"}
          </button>
        </form>
      )}
    </section>
  );
}

export function OperationsConfidentialBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { effectiveRole } = useAuth();
  if (effectiveRole === "admin") {
    return <ConfidentialBoundary>{children}</ConfidentialBoundary>;
  }
  if (effectiveRole === "supervisor") {
    return <SupervisorOperationsBoundary>{children}</SupervisorOperationsBoundary>;
  }
  return null;
}
