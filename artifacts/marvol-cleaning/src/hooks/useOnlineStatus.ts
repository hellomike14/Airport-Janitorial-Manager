import { useState, useEffect, useCallback, useRef } from "react";

export type SyncState = "idle" | "syncing" | "synced" | "error";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const markSyncing = useCallback(() => {
    setSyncState("syncing");
  }, []);

  const markSynced = useCallback(() => {
    setSyncState("synced");
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      setSyncState("idle");
    }, 3000);
  }, []);

  const markSyncError = useCallback(() => {
    setSyncState("error");
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      setSyncState("idle");
    }, 5000);
  }, []);

  return { isOnline, syncState, markSyncing, markSynced, markSyncError };
}
