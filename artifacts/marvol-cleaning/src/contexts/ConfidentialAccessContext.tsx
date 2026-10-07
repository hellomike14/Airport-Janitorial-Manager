import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getConfidentialAccess, configureConfidentialCode, unlockConfidentialAccess, lockConfidentialAccess,
  type ConfidentialAccessState,
} from "@workspace/api-client-react";
import { useAuth } from "./AuthContext";
import { cooldownMsLeft, isSensitiveKey, unlockedMsLeft } from "../lib/confidentialLogic";

export type LoadStatus = "idle" | "loading" | "error" | "ready";
interface Ctx {
  status: LoadStatus; access: ConfidentialAccessState | null; unlocked: boolean; configured: boolean;
  cooldownMs: number; errorCode: string | null; refresh: () => void;
  setup: (code: string, confirmation: string) => Promise<void>;
  change: (currentCode: string, code: string, confirmation: string) => Promise<void>;
  unlock: (code: string) => Promise<void>;
  lock: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
type Snap = { identity: string; status: LoadStatus; access: ConfidentialAccessState | null; at: number; errorCode: string | null; locked: boolean };
const blank = (identity: string): Snap => ({ identity, status: "loading", access: null, at: 0, errorCode: null, locked: false });
export const errorCodeOf = (e: unknown): string => {
  const d = (e as { data?: { code?: string; error?: string } })?.data;
  return d?.code ?? d?.error ?? "CONFIDENTIAL_UNAVAILABLE";
};

export function ConfidentialAccessProvider({ children }: { children: ReactNode }) {
  const { currentUser, effectiveRole } = useAuth();
  const qc = useQueryClient();
  const identity = `${currentUser?.id ?? ""}:${effectiveRole}`;
  const active = !!currentUser && effectiveRole === "admin";
  const [snap, setSnap] = useState<Snap>(() => blank(identity));
  const [now, setNow] = useState(() => Date.now());
  const identityRef = useRef(identity);
  identityRef.current = identity;
  // Bumped by every mutation and identity change; older in-flight results are ignored.
  const epoch = useRef(0);
  // True while a manual lock has not yet been confirmed revoked by the server.
  const pendingLock = useRef(false);

  const purge = useCallback(() => {
    qc.cancelQueries({ predicate: q => isSensitiveKey(q.queryKey) });
    qc.removeQueries({ predicate: q => isSensitiveKey(q.queryKey) });
  }, [qc]);

  const mine = snap.identity === identity;
  const access = active && mine ? snap.access : null;
  const at = mine ? snap.at : 0;
  const msLeft = unlockedMsLeft(access, at, now);
  const unlocked = active && mine && !snap.locked && msLeft > 0;
  const cooldownMs = cooldownMsLeft(access, at, now);
  const status: LoadStatus = !active ? "idle" : mine ? snap.status : "loading";

  useLayoutEffect(() => { epoch.current++; pendingLock.current = false; purge(); setSnap(blank(identity)); }, [identity, purge]);

  const apply = useCallback((s: ConfidentialAccessState, id: string, ep: number, reopen: boolean) => {
    if (identityRef.current !== id || epoch.current !== ep) return;
    setSnap(p => p.identity !== id ? p : { identity: id, status: "ready", access: s, at: Date.now(), errorCode: null, locked: reopen ? false : p.locked });
    setNow(Date.now());
  }, []);

  // Retry revoking the server grant for a manual lock.
  const revoke = useCallback(async () => {
    const id = identityRef.current; const ep = ++epoch.current;
    try {
      const s = await lockConfidentialAccess();
      if (identityRef.current !== id || epoch.current !== ep) return;
      pendingLock.current = false;
      setSnap(p => p.identity !== id ? p : { ...p, status: "ready", access: s, at: Date.now(), locked: false });
      setNow(Date.now());
    } catch { /* stays locally locked; retried on next status, refresh or reconnect */ }
  }, []);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = identity; let stop = false; let ctl: AbortController | undefined;
    const poll = async () => {
      ctl?.abort(); ctl = new AbortController();
      const ep = epoch.current;
      try {
        const s = await getConfidentialAccess(ctl.signal);
        if (stop) return;
        apply(s, id, ep, false);
        if (pendingLock.current && epoch.current === ep) void revoke();
      } catch (e) {
        if (stop || (e as Error)?.name === "AbortError" || epoch.current !== ep) return;
        const code = errorCodeOf(e);
        setSnap(p => p.identity !== id ? p : p.access && p.status === "ready" ? { ...p, access: { ...p.access, unlocked: false, expiresAt: null } } : { ...p, status: "error", errorCode: code });
        if (pendingLock.current) void revoke();
      }
    };
    void poll();
    const t = setInterval(poll, 15000);
    const online = () => void poll();
    window.addEventListener("online", online);
    return () => { stop = true; ctl?.abort(); clearInterval(t); window.removeEventListener("online", online); };
  }, [active, identity, apply, revoke, attempt]);

  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const exp = msLeft > 0 ? setTimeout(() => setNow(Date.now()), msLeft + 20) : undefined;
    return () => { clearInterval(tick); if (exp) clearTimeout(exp); };
  }, [active, msLeft > 0, access?.expiresAt, at]); // eslint-disable-line react-hooks/exhaustive-deps

  const wasUnlocked = useRef(false);
  useLayoutEffect(() => {
    if (wasUnlocked.current && !unlocked) purge();
    wasUnlocked.current = unlocked;
  }, [unlocked, purge]);

  const run = useCallback(async (fn: () => Promise<ConfidentialAccessState>) => {
    const id = identityRef.current; const ep = ++epoch.current;
    try {
      const s = await fn();
      if (identityRef.current !== id || epoch.current !== ep) return;
      pendingLock.current = false;
      apply(s, id, ep, true);
    }
    catch (e) {
      if (identityRef.current === id && epoch.current === ep) {
        const code = errorCodeOf(e);
        if (code === "CONFIDENTIAL_RATE_LIMIT" || code === "CONFIDENTIAL_LOCKED") setAttempt(a => a + 1);
      }
      throw e;
    }
  }, [apply]);

  const value = useMemo<Ctx>(() => ({
    status, access, unlocked, configured: !!access?.configured, cooldownMs, errorCode: mine ? snap.errorCode : null,
    refresh: () => {
      if (pendingLock.current) void revoke();
      setSnap(p => p.identity === identityRef.current ? { ...p, status: p.access ? p.status : "loading" } : p);
      setAttempt(a => a + 1);
    },
    setup: (code, confirmation) => run(() => configureConfidentialCode({ code, confirmation })).then(() => undefined),
    change: (currentCode, code, confirmation) => run(() => configureConfidentialCode({ code, confirmation, currentCode })).then(() => undefined),
    unlock: code => run(() => unlockConfidentialAccess(code)).then(() => undefined),
    lock: async () => {
      // Hide private views before any network round trip.
      pendingLock.current = true;
      epoch.current++;
      setSnap(p => p.identity === identityRef.current ? { ...p, locked: true } : p);
      purge();
      await revoke();
    },
  }), [status, access, unlocked, cooldownMs, mine, snap.errorCode, run, purge, revoke]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useConfidentialAccess() {
  const c = useContext(C);
  if (!c) throw new Error("useConfidentialAccess must be used inside ConfidentialAccessProvider");
  return c;
}
